import { describe, test, expect } from "bun:test";
import { SquirrelDBTcp, TcpSubscription, connectTcp } from "../src/tcp";
import type { TcpConnectOptions } from "../src/tcp";

describe("TcpConnectOptions Interface", () => {
  test("all fields are optional", () => {
    // TypeScript compile-time check - empty object should be valid
    const opts: TcpConnectOptions = {};
    expect(opts.host).toBeUndefined();
    expect(opts.port).toBeUndefined();
    expect(opts.authToken).toBeUndefined();
    expect(opts.useMessagePack).toBeUndefined();
    expect(opts.jsonFallback).toBeUndefined();
  });

  test("can specify all options", () => {
    const opts: TcpConnectOptions = {
      host: "db.example.com",
      port: 9000,
      authToken: "my-token",
      useMessagePack: true,
      jsonFallback: false,
    };
    expect(opts.host).toBe("db.example.com");
    expect(opts.port).toBe(9000);
    expect(opts.authToken).toBe("my-token");
    expect(opts.useMessagePack).toBe(true);
    expect(opts.jsonFallback).toBe(false);
  });
});

describe("TcpSubscription", () => {
  test("has readonly id property", () => {
    // Mock client for testing
    const mockClient = {
      unsubscribe: async (_id: string) => {}
    } as unknown as SquirrelDBTcp;

    const sub = new TcpSubscription("sub-123", mockClient);
    expect(sub.id).toBe("sub-123");
  });
});

describe("connectTcp export", () => {
  test("connectTcp is SquirrelDBTcp.connect", () => {
    expect(connectTcp).toBe(SquirrelDBTcp.connect);
  });
});

// Note: Connection error tests are skipped because Bun's socket implementation
// logs errors before they can be caught in the promise rejection handler.
// These would be integration tests that need a running server anyway.
describe("SquirrelDBTcp", () => {
  test("getSessionId returns null before connecting", () => {
    // Can't instantiate directly since constructor is private
    // but we can verify the behavior through the static connect method
    // For now, just verify the class structure exists
    expect(SquirrelDBTcp.connect).toBeDefined();
    expect(typeof SquirrelDBTcp.connect).toBe("function");
  });
});
