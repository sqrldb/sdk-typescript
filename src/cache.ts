/**
 * Cache client that connects to SquirrelDB's Redis-compatible cache server.
 * Uses RESP protocol (Redis Serialization Protocol) over TCP.
 */

import type { Socket } from "bun";

export interface CacheOptions {
  host?: string;
  port?: number;
}

type PendingRequest = {
  resolve: (value: RespValue) => void;
  reject: (err: Error) => void;
};

type RespValue = string | number | null | RespValue[];

/**
 * Redis-compatible cache client using RESP protocol.
 */
export class Cache {
  private socket: Socket<unknown> | null = null;
  private options: Required<CacheOptions>;
  private pending: PendingRequest[] = [];
  private readBuffer = "";
  private connectResolve: ((value: void) => void) | null = null;
  private connectReject: ((err: Error) => void) | null = null;
  private connected = false;

  private constructor(options: CacheOptions = {}) {
    this.options = {
      host: options.host ?? "localhost",
      port: options.port ?? 6379,
    };
  }

  /**
   * Connect to cache server.
   */
  static async connect(options?: CacheOptions): Promise<Cache> {
    const client = new Cache(options);
    await client.connectSocket();
    return client;
  }

  private async connectSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;

      Bun.connect({
        hostname: this.options.host,
        port: this.options.port,

        socket: {
          open: (socket) => {
            this.socket = socket;
            this.connected = true;
            this.connectResolve?.();
          },

          data: (_, data) => {
            this.handleData(new TextDecoder().decode(data));
          },

          close: () => {
            this.handleClose();
          },

          error: (_, error) => {
            if (!this.connected && this.connectReject) {
              this.connectReject(new Error(`Connection error: ${error}`));
            }
          },
        },
      });
    });
  }

  private handleData(data: string): void {
    this.readBuffer += data;
    this.processResponses();
  }

  private processResponses(): void {
    while (this.readBuffer.length > 0 && this.pending.length > 0) {
      const result = this.parseResp();
      if (result === undefined) {
        // Not enough data yet
        return;
      }

      const request = this.pending.shift();
      if (request) {
        if (result instanceof Error) {
          request.reject(result);
        } else {
          request.resolve(result);
        }
      }
    }
  }

  /**
   * Parse RESP response from buffer.
   * Returns undefined if not enough data, Error for RESP errors.
   */
  private parseResp(): RespValue | Error | undefined {
    if (this.readBuffer.length === 0) return undefined;

    const type = this.readBuffer[0];
    const crlfIndex = this.readBuffer.indexOf("\r\n");
    if (crlfIndex === -1) return undefined;

    const line = this.readBuffer.slice(1, crlfIndex);

    switch (type) {
      case "+": {
        // Simple string: +OK\r\n
        this.readBuffer = this.readBuffer.slice(crlfIndex + 2);
        return line;
      }

      case "-": {
        // Error: -ERR message\r\n
        this.readBuffer = this.readBuffer.slice(crlfIndex + 2);
        return new Error(line);
      }

      case ":": {
        // Integer: :42\r\n
        this.readBuffer = this.readBuffer.slice(crlfIndex + 2);
        return parseInt(line, 10);
      }

      case "$": {
        // Bulk string: $5\r\nhello\r\n or $-1\r\n (null)
        const length = parseInt(line, 10);
        if (length === -1) {
          this.readBuffer = this.readBuffer.slice(crlfIndex + 2);
          return null;
        }

        const dataStart = crlfIndex + 2;
        const dataEnd = dataStart + length;
        const expectedEnd = dataEnd + 2; // +2 for trailing \r\n

        if (this.readBuffer.length < expectedEnd) return undefined;

        const value = this.readBuffer.slice(dataStart, dataEnd);
        this.readBuffer = this.readBuffer.slice(expectedEnd);
        return value;
      }

      case "*": {
        // Array: *2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n or *-1\r\n (null)
        const count = parseInt(line, 10);
        if (count === -1) {
          this.readBuffer = this.readBuffer.slice(crlfIndex + 2);
          return null;
        }

        // Save buffer state to restore if we don't have enough data
        const savedBuffer = this.readBuffer;
        this.readBuffer = this.readBuffer.slice(crlfIndex + 2);

        const items: RespValue[] = [];
        for (let i = 0; i < count; i++) {
          const item = this.parseResp();
          if (item === undefined) {
            // Not enough data, restore buffer
            this.readBuffer = savedBuffer;
            return undefined;
          }
          if (item instanceof Error) {
            // Restore and propagate error
            this.readBuffer = savedBuffer;
            return item;
          }
          items.push(item);
        }
        return items;
      }

      default:
        // Unknown type, consume line and return error
        this.readBuffer = this.readBuffer.slice(crlfIndex + 2);
        return new Error(`Unknown RESP type: ${type}`);
    }
  }

  private handleClose(): void {
    this.connected = false;
    // Reject all pending requests
    for (const req of this.pending) {
      req.reject(new Error("Connection closed"));
    }
    this.pending = [];
  }

  /**
   * Encode and send a RESP command.
   */
  private async sendCommand(...args: (string | number)[]): Promise<RespValue> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.connected) {
        reject(new Error("Not connected"));
        return;
      }

      this.pending.push({ resolve, reject });

      // Build RESP array command: *n\r\n$len\r\narg\r\n...
      let cmd = `*${args.length}\r\n`;
      for (const arg of args) {
        const str = String(arg);
        cmd += `$${str.length}\r\n${str}\r\n`;
      }

      this.socket.write(cmd);
    });
  }

  // =========================================================================
  // Basic Operations
  // =========================================================================

  /**
   * Get the value of a key.
   */
  async get(key: string): Promise<string | null> {
    const result = await this.sendCommand("GET", key);
    return result as string | null;
  }

  /**
   * Set the value of a key with optional TTL.
   */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds !== undefined) {
      await this.sendCommand("SET", key, value, "EX", ttlSeconds);
    } else {
      await this.sendCommand("SET", key, value);
    }
  }

  /**
   * Delete a key.
   */
  async del(key: string): Promise<boolean> {
    const result = await this.sendCommand("DEL", key);
    return (result as number) > 0;
  }

  /**
   * Check if a key exists.
   */
  async exists(key: string): Promise<boolean> {
    const result = await this.sendCommand("EXISTS", key);
    return (result as number) > 0;
  }

  // =========================================================================
  // TTL Operations
  // =========================================================================

  /**
   * Set a key's time to live in seconds.
   */
  async expire(key: string, seconds: number): Promise<boolean> {
    const result = await this.sendCommand("EXPIRE", key, seconds);
    return (result as number) === 1;
  }

  /**
   * Get the time to live for a key in seconds.
   * Returns -1 if key has no TTL, -2 if key doesn't exist.
   */
  async ttl(key: string): Promise<number> {
    const result = await this.sendCommand("TTL", key);
    return result as number;
  }

  /**
   * Remove the TTL from a key.
   */
  async persist(key: string): Promise<boolean> {
    const result = await this.sendCommand("PERSIST", key);
    return (result as number) === 1;
  }

  // =========================================================================
  // Numeric Operations
  // =========================================================================

  /**
   * Increment the integer value of a key by one.
   */
  async incr(key: string): Promise<number> {
    const result = await this.sendCommand("INCR", key);
    return result as number;
  }

  /**
   * Decrement the integer value of a key by one.
   */
  async decr(key: string): Promise<number> {
    const result = await this.sendCommand("DECR", key);
    return result as number;
  }

  /**
   * Increment the integer value of a key by the given amount.
   */
  async incrby(key: string, amount: number): Promise<number> {
    const result = await this.sendCommand("INCRBY", key, amount);
    return result as number;
  }

  // =========================================================================
  // Bulk Operations
  // =========================================================================

  /**
   * Find all keys matching a pattern.
   * Pattern uses glob-style matching (* matches any sequence, ? matches single char).
   */
  async keys(pattern?: string): Promise<string[]> {
    const result = await this.sendCommand("KEYS", pattern ?? "*");
    return (result as (string | null)[]).filter((k): k is string => k !== null);
  }

  /**
   * Get the values of all the given keys.
   */
  async mget(...keys: string[]): Promise<(string | null)[]> {
    const result = await this.sendCommand("MGET", ...keys);
    return result as (string | null)[];
  }

  /**
   * Set multiple keys to multiple values.
   */
  async mset(pairs: Record<string, string>): Promise<void> {
    const args: string[] = ["MSET"];
    for (const [key, value] of Object.entries(pairs)) {
      args.push(key, value);
    }
    await this.sendCommand(...args);
  }

  // =========================================================================
  // Admin Operations
  // =========================================================================

  /**
   * Return the number of keys in the current database.
   */
  async dbsize(): Promise<number> {
    const result = await this.sendCommand("DBSIZE");
    return result as number;
  }

  /**
   * Delete all keys from the current database.
   */
  async flush(): Promise<void> {
    await this.sendCommand("FLUSHDB");
  }

  /**
   * Get information and statistics about the server.
   */
  async info(): Promise<Record<string, string | number>> {
    const result = await this.sendCommand("INFO");
    const info: Record<string, string | number> = {};

    if (typeof result === "string") {
      for (const line of result.split("\r\n")) {
        if (line && !line.startsWith("#")) {
          const colonIndex = line.indexOf(":");
          if (colonIndex !== -1) {
            const key = line.slice(0, colonIndex);
            const value = line.slice(colonIndex + 1);
            // Try to parse as number
            const numValue = parseFloat(value);
            info[key] = isNaN(numValue) ? value : numValue;
          }
        }
      }
    }

    return info;
  }

  /**
   * Ping the server.
   */
  async ping(): Promise<boolean> {
    const result = await this.sendCommand("PING");
    return result === "PONG";
  }

  /**
   * Close the connection.
   */
  close(): void {
    this.connected = false;
    this.socket?.end();
    this.socket = null;
  }
}
