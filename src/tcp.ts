/**
 * SquirrelDB TCP wire protocol client implementation.
 */

import { Socket } from "bun";
import type { ChangeEvent, Document, ServerMessage, ClientMessage } from "./types";
import {
  PROTOCOL_VERSION,
  MAX_MESSAGE_SIZE,
  HandshakeStatus,
  MessageType,
  Encoding,
  buildHandshake,
  parseHandshakeResponse,
  encodeMessage,
  decodeMessage,
  buildFrame,
  parseFrameHeader,
  uuidToString,
} from "./protocol";

export interface TcpConnectOptions {
  host?: string;
  port?: number;
  authToken?: string;
  useMessagePack?: boolean;
  jsonFallback?: boolean;
}

type PendingRequest = {
  resolve: (msg: ServerMessage) => void;
  reject: (err: Error) => void;
};

interface Subscription {
  callback: (change: ChangeEvent) => void;
}

/**
 * TCP wire protocol client for SquirrelDB.
 */
export class SquirrelDBTcp {
  private socket: ReturnType<typeof Socket> | null = null;
  private options: Required<TcpConnectOptions>;
  private sessionId: string | null = null;
  private encoding: Encoding = Encoding.MessagePack;
  private pending = new Map<string, PendingRequest>();
  private subscriptions = new Map<string, Subscription>();
  private requestId = 0;
  private readBuffer = new Uint8Array(0);
  private handshakeResolve: ((value: void) => void) | null = null;
  private handshakeReject: ((err: Error) => void) | null = null;
  private handshakeCompleted = false;

  private constructor(options: TcpConnectOptions = {}) {
    this.options = {
      host: options.host ?? "localhost",
      port: options.port ?? 8082,
      authToken: options.authToken ?? "",
      useMessagePack: options.useMessagePack ?? true,
      jsonFallback: options.jsonFallback ?? true,
    };
  }

  /**
   * Connect to SquirrelDB server via TCP wire protocol.
   */
  static async connect(options?: TcpConnectOptions): Promise<SquirrelDBTcp> {
    const client = new SquirrelDBTcp(options);
    await client.connectSocket();
    return client;
  }

  /**
   * Get the session ID.
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  private async connectSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.handshakeResolve = resolve;
      this.handshakeReject = reject;

      this.socket = Bun.connect({
        hostname: this.options.host,
        port: this.options.port,

        socket: {
          open: (socket) => {
            // Send handshake
            const handshake = buildHandshake(this.options.authToken, {
              messagepack: this.options.useMessagePack,
              jsonFallback: this.options.jsonFallback,
            });
            socket.write(handshake);
          },

          data: (socket, data) => {
            this.handleData(new Uint8Array(data));
          },

          close: () => {
            this.handleClose();
          },

          error: (socket, error) => {
            if (!this.handshakeCompleted && this.handshakeReject) {
              this.handshakeReject(new Error(`Connection error: ${error}`));
            }
          },
        },
      });
    });
  }

  private handleData(data: Uint8Array): void {
    // Append to read buffer
    const newBuffer = new Uint8Array(this.readBuffer.length + data.length);
    newBuffer.set(this.readBuffer);
    newBuffer.set(data, this.readBuffer.length);
    this.readBuffer = newBuffer;

    // If handshake not completed, try to parse handshake response
    if (!this.handshakeCompleted) {
      if (this.readBuffer.length >= 19) {
        try {
          const response = parseHandshakeResponse(this.readBuffer.slice(0, 19));
          this.readBuffer = this.readBuffer.slice(19);

          if (response.status === HandshakeStatus.VersionMismatch) {
            this.handshakeReject?.(
              new Error(
                `Version mismatch: server=${response.version}, client=${PROTOCOL_VERSION}`
              )
            );
            return;
          }

          if (response.status === HandshakeStatus.AuthFailed) {
            this.handshakeReject?.(new Error("Authentication failed"));
            return;
          }

          if (response.status !== HandshakeStatus.Success) {
            this.handshakeReject?.(new Error(`Unexpected status: ${response.status}`));
            return;
          }

          this.sessionId = uuidToString(response.sessionId);
          this.encoding = response.flags.messagepack
            ? Encoding.MessagePack
            : Encoding.Json;
          this.handshakeCompleted = true;
          this.handshakeResolve?.();
        } catch (e) {
          this.handshakeReject?.(e as Error);
        }
      }
      return;
    }

    // Process framed messages
    this.processFrames();
  }

  private processFrames(): void {
    while (this.readBuffer.length >= 6) {
      const header = parseFrameHeader(this.readBuffer);

      if (header.payloadLength > MAX_MESSAGE_SIZE) {
        console.error(`Message too large: ${header.payloadLength}`);
        return;
      }

      const totalLength = 6 + header.payloadLength;
      if (this.readBuffer.length < totalLength) {
        // Not enough data yet
        return;
      }

      const payload = this.readBuffer.slice(6, totalLength);
      this.readBuffer = this.readBuffer.slice(totalLength);

      try {
        const msg = decodeMessage<ServerMessage>(payload, header.encoding);
        this.dispatchMessage(msg);
      } catch (e) {
        console.error("Failed to decode message:", e);
      }
    }
  }

  private dispatchMessage(msg: ServerMessage): void {
    if (msg.type === "change") {
      const sub = this.subscriptions.get(msg.id);
      if (sub) {
        sub.callback(msg.change);
      }
      return;
    }

    const pending = this.pending.get(msg.id);
    if (pending) {
      this.pending.delete(msg.id);
      pending.resolve(msg);
    }
  }

  private handleClose(): void {
    // Reject all pending requests
    for (const [, req] of this.pending) {
      req.reject(new Error("Connection closed"));
    }
    this.pending.clear();
  }

  private nextId(): string {
    return String(++this.requestId);
  }

  private async send(msg: ClientMessage): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("Not connected"));
        return;
      }

      this.pending.set(msg.id, { resolve, reject });

      const payload = encodeMessage(msg, this.encoding);
      const frame = buildFrame(MessageType.Request, this.encoding, payload);
      this.socket.write(frame);
    });
  }

  /**
   * Execute a query.
   */
  async query<T = unknown>(q: string): Promise<T[]> {
    const resp = await this.send({ type: "query", id: this.nextId(), query: q });
    if (resp.type === "error") throw new Error(resp.error);
    if (resp.type === "result") return resp.data as T[];
    throw new Error("Unexpected response");
  }

  /**
   * Execute a query and return raw data.
   */
  async queryRaw(q: string): Promise<unknown> {
    const resp = await this.send({ type: "query", id: this.nextId(), query: q });
    if (resp.type === "error") throw new Error(resp.error);
    if (resp.type === "result") return resp.data;
    throw new Error("Unexpected response");
  }

  /**
   * Subscribe to changes.
   */
  async subscribe(
    q: string,
    callback: (change: ChangeEvent) => void
  ): Promise<TcpSubscription> {
    const id = this.nextId();
    const resp = await this.send({ type: "subscribe", id, query: q });
    if (resp.type === "error") throw new Error(resp.error);

    this.subscriptions.set(id, { callback });
    return new TcpSubscription(id, this);
  }

  /**
   * Unsubscribe from changes.
   */
  async unsubscribe(subscriptionId: string): Promise<void> {
    this.subscriptions.delete(subscriptionId);
    if (this.socket) {
      const msg: ClientMessage = { type: "unsubscribe", id: subscriptionId };
      const payload = encodeMessage(msg, this.encoding);
      const frame = buildFrame(MessageType.Request, this.encoding, payload);
      this.socket.write(frame);
    }
  }

  /**
   * Insert a document.
   */
  async insert<T = unknown>(collection: string, data: T): Promise<Document<T>> {
    const resp = await this.send({
      type: "insert",
      id: this.nextId(),
      collection,
      data,
    });
    if (resp.type === "error") throw new Error(resp.error);
    if (resp.type === "result") return resp.data as Document<T>;
    throw new Error("Unexpected response");
  }

  /**
   * Update a document.
   */
  async update<T = unknown>(
    collection: string,
    documentId: string,
    data: T
  ): Promise<Document<T>> {
    const resp = await this.send({
      type: "update",
      id: this.nextId(),
      collection,
      document_id: documentId,
      data,
    });
    if (resp.type === "error") throw new Error(resp.error);
    if (resp.type === "result") return resp.data as Document<T>;
    throw new Error("Unexpected response");
  }

  /**
   * Delete a document.
   */
  async delete(collection: string, documentId: string): Promise<Document> {
    const resp = await this.send({
      type: "delete",
      id: this.nextId(),
      collection,
      document_id: documentId,
    });
    if (resp.type === "error") throw new Error(resp.error);
    if (resp.type === "result") return resp.data as Document;
    throw new Error("Unexpected response");
  }

  /**
   * List all collections.
   */
  async listCollections(): Promise<string[]> {
    const resp = await this.send({ type: "listcollections", id: this.nextId() });
    if (resp.type === "error") throw new Error(resp.error);
    if (resp.type === "result") return resp.data as string[];
    throw new Error("Unexpected response");
  }

  /**
   * Ping the server.
   */
  async ping(): Promise<void> {
    const resp = await this.send({ type: "ping", id: this.nextId() });
    if (resp.type !== "pong") throw new Error("Unexpected response");
  }

  /**
   * Close the connection.
   */
  close(): void {
    this.subscriptions.clear();
    this.socket?.end();
    this.socket = null;
  }
}

/**
 * Subscription handle for TCP connections.
 */
export class TcpSubscription {
  constructor(
    public readonly id: string,
    private client: SquirrelDBTcp
  ) {}

  /**
   * Unsubscribe from changes.
   */
  async unsubscribe(): Promise<void> {
    await this.client.unsubscribe(this.id);
  }
}

/**
 * Convenience function to connect via TCP.
 */
export const connectTcp = SquirrelDBTcp.connect;
