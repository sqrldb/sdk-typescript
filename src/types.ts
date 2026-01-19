// Document stored in SquirrelDB
export interface Document<T = Record<string, unknown>> {
  id: string;
  collection: string;
  data: T;
  created_at: string;
  updated_at: string;
}

// Client -> Server messages
export type ClientMessage =
  | { type: "query"; id: string; query: string }
  | { type: "subscribe"; id: string; query: string }
  | { type: "unsubscribe"; id: string }
  | { type: "insert"; id: string; collection: string; data: unknown }
  | { type: "update"; id: string; collection: string; document_id: string; data: unknown }
  | { type: "delete"; id: string; collection: string; document_id: string }
  | { type: "listcollections"; id: string }
  | { type: "ping"; id: string };

// Server -> Client messages
export type ServerMessage =
  | { type: "result"; id: string; data: unknown }
  | { type: "change"; id: string; change: ChangeEvent }
  | { type: "subscribed"; id: string }
  | { type: "unsubscribed"; id: string }
  | { type: "error"; id: string; error: string }
  | { type: "pong"; id: string };

// Change events for subscriptions
export type ChangeEvent =
  | { type: "initial"; document: Document }
  | { type: "insert"; new: Document }
  | { type: "update"; old: unknown; new: Document }
  | { type: "delete"; old: Document };

// Connection options
export interface ConnectOptions {
  /** Reconnect automatically on disconnect (default: true) */
  reconnect?: boolean;
  /** Max reconnection attempts (default: 10) */
  maxReconnectAttempts?: number;
  /** Base delay between reconnects in ms (default: 1000) */
  reconnectDelay?: number;
}

// Subscription callback
export type ChangeCallback = (change: ChangeEvent) => void;
