export * from "./types";
export * from "./protocol";
export * from "./query";
export * from "./storage";
export { SquirrelDBTcp, TcpSubscription, connectTcp } from "./tcp";
export type { TcpConnectOptions } from "./tcp";
export { Cache } from "./cache";
export type { CacheOptions } from "./cache";

import type {
  ClientMessage,
  ServerMessage,
  ChangeCallback,
  ConnectOptions,
  Document,
} from "./types";

import { QueryBuilder, table, createDocProxy, and, or, not, field } from "./query";
import type { FilterCondition, DocProxy, StructuredQuery } from "./query";

type PendingRequest = {
  resolve: (msg: ServerMessage) => void;
  reject: (err: Error) => void;
};

/**
 * Table reference for fluent query building
 * Uses MongoDB-like naming: find/sort/limit
 */
class TableRef<T = unknown> {
  constructor(
    private client: SquirrelDB,
    private tableName: string
  ) {}

  /**
   * Find documents matching condition (callback with doc proxy)
   * Usage: .find(doc => doc.age.gt(21))
   */
  find(fn: (doc: DocProxy) => FilterCondition): ExecutableQuery<T>;
  /**
   * Find documents matching condition (object)
   * Usage: .find({ age: { $gt: 21 } })
   */
  find(condition: FilterCondition): ExecutableQuery<T>;
  find(arg: ((doc: DocProxy) => FilterCondition) | FilterCondition): ExecutableQuery<T> {
    const builder = new QueryBuilder<T>(this.tableName);
    builder.find(arg as FilterCondition);
    return new ExecutableQuery(this.client, builder);
  }

  /**
   * Sort by field
   * Usage: .sort("name") or .sort("age", "desc")
   */
  sort(fieldName: string, direction?: "asc" | "desc"): ExecutableQuery<T> {
    const builder = new QueryBuilder<T>(this.tableName);
    builder.sort(fieldName, direction);
    return new ExecutableQuery(this.client, builder);
  }

  /**
   * Limit results
   */
  limit(n: number): ExecutableQuery<T> {
    const builder = new QueryBuilder<T>(this.tableName);
    builder.limit(n);
    return new ExecutableQuery(this.client, builder);
  }

  /**
   * Get all documents from the table
   */
  async all(): Promise<T[]> {
    return this.client.queryStructured<T>({ table: this.tableName });
  }

  /**
   * Execute the query (alias for all)
   */
  async run(): Promise<T[]> {
    return this.all();
  }

  /**
   * Subscribe to all changes on this table
   */
  async changes(callback: ChangeCallback): Promise<string> {
    return this.client.subscribeStructured(
      { table: this.tableName, changes: { includeInitial: false } },
      callback
    );
  }

  /**
   * Get the underlying query builder
   */
  toBuilder(): QueryBuilder<T> {
    return new QueryBuilder<T>(this.tableName);
  }
}

/**
 * Executable query that can be run or subscribed to
 */
class ExecutableQuery<T = unknown> {
  constructor(
    private client: SquirrelDB,
    private builder: QueryBuilder<T>
  ) {}

  /**
   * Add additional find condition
   */
  find(fn: (doc: DocProxy) => FilterCondition): ExecutableQuery<T>;
  find(condition: FilterCondition): ExecutableQuery<T>;
  find(arg: ((doc: DocProxy) => FilterCondition) | FilterCondition): ExecutableQuery<T> {
    this.builder.find(arg as FilterCondition);
    return this;
  }

  /**
   * Sort by field
   */
  sort(fieldName: string, direction?: "asc" | "desc"): ExecutableQuery<T> {
    this.builder.sort(fieldName, direction);
    return this;
  }

  /**
   * Limit results
   */
  limit(n: number): ExecutableQuery<T> {
    this.builder.limit(n);
    return this;
  }

  /**
   * Skip results (offset)
   */
  skip(n: number): ExecutableQuery<T> {
    this.builder.skip(n);
    return this;
  }

  /**
   * Execute the query using structured query format (no JS evaluation on server)
   */
  async run(): Promise<T[]> {
    return this.client.queryStructured<T>(this.builder.compileStructured());
  }

  /**
   * Subscribe to changes matching this query
   */
  async changes(callback: ChangeCallback): Promise<string> {
    this.builder.changes();
    return this.client.subscribeStructured(this.builder.compileStructured(), callback);
  }

  /**
   * Get the compiled query string
   */
  toString(): string {
    return this.builder.compile();
  }
}

/**
 * Subscription builder for fluent change subscriptions
 * Usage: db.subscribe("users").changes((change) => {})
 */
class SubscriptionBuilder<T = unknown> {
  constructor(
    private client: SquirrelDB,
    private tableName: string
  ) {}

  /**
   * Filter changes matching condition
   */
  find(fn: (doc: DocProxy) => FilterCondition): SubscriptionBuilder<T>;
  find(condition: FilterCondition): SubscriptionBuilder<T>;
  find(arg: ((doc: DocProxy) => FilterCondition) | FilterCondition): SubscriptionBuilder<T> {
    const builder = new QueryBuilder<T>(this.tableName);
    builder.find(arg as FilterCondition);
    return new FilteredSubscriptionBuilder<T>(this.client, builder);
  }

  /**
   * Subscribe to all changes on this table
   */
  async changes(callback: ChangeCallback): Promise<string> {
    return this.client.subscribeStructured(
      { table: this.tableName, changes: { includeInitial: false } },
      callback
    );
  }
}

/**
 * Subscription builder with filter applied
 */
class FilteredSubscriptionBuilder<T = unknown> extends SubscriptionBuilder<T> {
  constructor(
    private _client: SquirrelDB,
    private builder: QueryBuilder<T>
  ) {
    super(_client, "");
  }

  /**
   * Subscribe to filtered changes
   */
  async changes(callback: ChangeCallback): Promise<string> {
    this.builder.changes();
    return this._client.subscribeStructured(this.builder.compileStructured(), callback);
  }
}

export class SquirrelDB {
  private ws: WebSocket | null = null;
  private url: string;
  private options: Required<ConnectOptions>;
  private pending = new Map<string, PendingRequest>();
  private subscriptions = new Map<string, ChangeCallback>();
  private reconnectAttempts = 0;
  private closed = false;

  private constructor(url: string, options: ConnectOptions = {}) {
    this.url = url.startsWith("ws://") || url.startsWith("wss://") ? url : `ws://${url}`;
    this.options = {
      reconnect: options.reconnect ?? true,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 10,
      reconnectDelay: options.reconnectDelay ?? 1000,
    };
  }

  /** Connect to SquirrelDB server */
  static async connect(url: string, options?: ConnectOptions): Promise<SquirrelDB> {
    const client = new SquirrelDB(url, options);
    await client.connectWs();
    return client;
  }

  private async connectWs(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        resolve();
      };

      this.ws.onerror = () => {
        if (this.reconnectAttempts === 0) {
          reject(new Error("Failed to connect"));
        }
      };

      this.ws.onclose = () => {
        this.handleDisconnect();
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data as string);
      };
    });
  }

  private handleMessage(data: string): void {
    try {
      const msg = JSON.parse(data) as ServerMessage;

      if (msg.type === "change") {
        const callback = this.subscriptions.get(msg.id);
        if (callback) callback(msg.change);
        return;
      }

      const pending = this.pending.get(msg.id);
      if (pending) {
        this.pending.delete(msg.id);
        pending.resolve(msg);
      }
    } catch {
      // Ignore malformed messages
    }
  }

  private handleDisconnect(): void {
    if (this.closed) return;

    // Reject all pending requests
    for (const [, req] of this.pending) {
      req.reject(new Error("Connection closed"));
    }
    this.pending.clear();

    // Attempt reconnection
    if (this.options.reconnect && this.reconnectAttempts < this.options.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.options.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
      setTimeout(() => this.connectWs().catch(() => {}), delay);
    }
  }

  private send(msg: ClientMessage): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("Not connected"));
        return;
      }

      this.pending.set(msg.id, { resolve, reject });
      this.ws.send(JSON.stringify(msg));
    });
  }

  private generateId(): string {
    return crypto.randomUUID();
  }

  // =========================================================================
  // Query Builder API (Native TypeScript)
  // =========================================================================

  /**
   * Get a table reference for fluent queries
   * Usage: db.table("users").find(doc => doc.age.gt(21)).run()
   */
  table<T = unknown>(name: string): TableRef<T> {
    return new TableRef<T>(this, name);
  }

  /**
   * Subscribe to changes on a table (fluent API)
   * Usage: db.subscribe("users").changes((change) => {})
   * Usage: db.subscribe("users").find(doc => doc.status.eq("active")).changes((change) => {})
   */
  subscribe<T = unknown>(tableName: string): SubscriptionBuilder<T> {
    return new SubscriptionBuilder<T>(this, tableName);
  }

  // =========================================================================
  // Structured Query API (preferred)
  // =========================================================================

  /** Execute a structured query (no JS evaluation on server) */
  async queryStructured<T = unknown>(q: StructuredQuery): Promise<T[]> {
    const resp = await this.send({ type: "query", id: this.generateId(), query: q });
    if (resp.type === "error") throw new Error(resp.error);
    if (resp.type === "result") return resp.data as T[];
    throw new Error("Unexpected response");
  }

  /** Subscribe to changes with structured query */
  async subscribeStructured(q: StructuredQuery, callback: ChangeCallback): Promise<string> {
    const id = this.generateId();
    const resp = await this.send({ type: "subscribe", id, query: q });
    if (resp.type === "error") throw new Error(resp.error);
    this.subscriptions.set(id, callback);
    return id;
  }

  // =========================================================================
  // Raw Query API (legacy)
  // =========================================================================

  /** Execute a raw query string (legacy, prefer queryStructured) */
  async query<T = unknown>(q: string): Promise<T[]> {
    const resp = await this.send({ type: "query", id: this.generateId(), query: q });
    if (resp.type === "error") throw new Error(resp.error);
    if (resp.type === "result") return resp.data as T[];
    throw new Error("Unexpected response");
  }

  /** Subscribe to changes with raw query string (legacy, prefer db.subscribe("table").changes()) */
  async subscribeRaw(q: string, callback: ChangeCallback): Promise<string> {
    const id = this.generateId();
    const resp = await this.send({ type: "subscribe", id, query: q });
    if (resp.type === "error") throw new Error(resp.error);
    this.subscriptions.set(id, callback);
    return id;
  }

  /** Unsubscribe from changes */
  async unsubscribe(subscriptionId: string): Promise<void> {
    await this.send({ type: "unsubscribe", id: subscriptionId });
    this.subscriptions.delete(subscriptionId);
  }

  // =========================================================================
  // CRUD Operations
  // =========================================================================

  /** Insert a document */
  async insert<T = unknown>(collection: string, data: T): Promise<Document<T>> {
    const resp = await this.send({
      type: "insert",
      id: this.generateId(),
      collection,
      data,
    });
    if (resp.type === "error") throw new Error(resp.error);
    if (resp.type === "result") return resp.data as Document<T>;
    throw new Error("Unexpected response");
  }

  /** Update a document */
  async update<T = unknown>(collection: string, documentId: string, data: T): Promise<Document<T>> {
    const resp = await this.send({
      type: "update",
      id: this.generateId(),
      collection,
      document_id: documentId,
      data,
    });
    if (resp.type === "error") throw new Error(resp.error);
    if (resp.type === "result") return resp.data as Document<T>;
    throw new Error("Unexpected response");
  }

  /** Delete a document */
  async delete(collection: string, documentId: string): Promise<Document> {
    const resp = await this.send({
      type: "delete",
      id: this.generateId(),
      collection,
      document_id: documentId,
    });
    if (resp.type === "error") throw new Error(resp.error);
    if (resp.type === "result") return resp.data as Document;
    throw new Error("Unexpected response");
  }

  /** List all collections */
  async listCollections(): Promise<string[]> {
    const resp = await this.send({ type: "listcollections", id: this.generateId() });
    if (resp.type === "error") throw new Error(resp.error);
    if (resp.type === "result") return resp.data as string[];
    throw new Error("Unexpected response");
  }

  /** Ping the server */
  async ping(): Promise<void> {
    const resp = await this.send({ type: "ping", id: this.generateId() });
    if (resp.type !== "pong") throw new Error("Unexpected response");
  }

  /** Close the connection */
  close(): void {
    this.closed = true;
    this.subscriptions.clear();
    this.ws?.close();
  }
}

// Convenience function
export const connect = SquirrelDB.connect;

// Re-export query helpers for standalone use
export { table, and, or, not, field, createDocProxy };
