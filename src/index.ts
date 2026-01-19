export * from "./types";
export * from "./protocol";
export { SquirrelDBTcp, TcpSubscription, connectTcp } from "./tcp";
export type { TcpConnectOptions } from "./tcp";

import type {
  ClientMessage,
  ServerMessage,
  ChangeEvent,
  ChangeCallback,
  ConnectOptions,
  Document,
} from "./types";

type PendingRequest = {
  resolve: (msg: ServerMessage) => void;
  reject: (err: Error) => void;
};

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

      this.ws.onerror = (e) => {
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

  /** Execute a query */
  async query<T = unknown>(q: string): Promise<T[]> {
    const resp = await this.send({ type: "query", id: this.generateId(), query: q });
    if (resp.type === "error") throw new Error(resp.error);
    if (resp.type === "result") return resp.data as T[];
    throw new Error("Unexpected response");
  }

  /** Subscribe to changes */
  async subscribe(q: string, callback: ChangeCallback): Promise<string> {
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
