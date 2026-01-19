import { describe, test, expect } from "bun:test";
import {
  MAGIC,
  PROTOCOL_VERSION,
  MAX_MESSAGE_SIZE,
  HandshakeStatus,
  MessageType,
  Encoding,
  flagsToByte,
  byteToFlags,
  buildHandshake,
  parseHandshakeResponse,
  encodeMessage,
  decodeMessage,
  buildFrame,
  parseFrameHeader,
  uuidToString,
} from "../src/protocol";

describe("Protocol Constants", () => {
  test("MAGIC is SQRL in bytes", () => {
    expect(MAGIC).toEqual(new Uint8Array([0x53, 0x51, 0x52, 0x4c]));
    expect(new TextDecoder().decode(MAGIC)).toBe("SQRL");
  });

  test("PROTOCOL_VERSION is 0x01", () => {
    expect(PROTOCOL_VERSION).toBe(0x01);
  });

  test("MAX_MESSAGE_SIZE is 16MB", () => {
    expect(MAX_MESSAGE_SIZE).toBe(16 * 1024 * 1024);
  });
});

describe("HandshakeStatus", () => {
  test("Success is 0x00", () => {
    expect(HandshakeStatus.Success).toBe(0x00);
  });

  test("VersionMismatch is 0x01", () => {
    expect(HandshakeStatus.VersionMismatch).toBe(0x01);
  });

  test("AuthFailed is 0x02", () => {
    expect(HandshakeStatus.AuthFailed).toBe(0x02);
  });
});

describe("MessageType", () => {
  test("Request is 0x01", () => {
    expect(MessageType.Request).toBe(0x01);
  });

  test("Response is 0x02", () => {
    expect(MessageType.Response).toBe(0x02);
  });

  test("Notification is 0x03", () => {
    expect(MessageType.Notification).toBe(0x03);
  });
});

describe("Encoding", () => {
  test("MessagePack is 0x01", () => {
    expect(Encoding.MessagePack).toBe(0x01);
  });

  test("Json is 0x02", () => {
    expect(Encoding.Json).toBe(0x02);
  });
});

describe("ProtocolFlags", () => {
  test("flagsToByte with both false", () => {
    expect(flagsToByte({ messagepack: false, jsonFallback: false })).toBe(0x00);
  });

  test("flagsToByte with messagepack only", () => {
    expect(flagsToByte({ messagepack: true, jsonFallback: false })).toBe(0x01);
  });

  test("flagsToByte with jsonFallback only", () => {
    expect(flagsToByte({ messagepack: false, jsonFallback: true })).toBe(0x02);
  });

  test("flagsToByte with both true", () => {
    expect(flagsToByte({ messagepack: true, jsonFallback: true })).toBe(0x03);
  });

  test("byteToFlags from 0x00", () => {
    const flags = byteToFlags(0x00);
    expect(flags.messagepack).toBe(false);
    expect(flags.jsonFallback).toBe(false);
  });

  test("byteToFlags from 0x01", () => {
    const flags = byteToFlags(0x01);
    expect(flags.messagepack).toBe(true);
    expect(flags.jsonFallback).toBe(false);
  });

  test("byteToFlags from 0x02", () => {
    const flags = byteToFlags(0x02);
    expect(flags.messagepack).toBe(false);
    expect(flags.jsonFallback).toBe(true);
  });

  test("byteToFlags from 0x03", () => {
    const flags = byteToFlags(0x03);
    expect(flags.messagepack).toBe(true);
    expect(flags.jsonFallback).toBe(true);
  });

  test("roundtrip conversion", () => {
    for (const messagepack of [true, false]) {
      for (const jsonFallback of [true, false]) {
        const flags = { messagepack, jsonFallback };
        const byte = flagsToByte(flags);
        const restored = byteToFlags(byte);
        expect(restored.messagepack).toBe(messagepack);
        expect(restored.jsonFallback).toBe(jsonFallback);
      }
    }
  });
});

describe("buildHandshake", () => {
  test("handshake without auth", () => {
    const data = buildHandshake();
    expect(data.slice(0, 4)).toEqual(MAGIC);
    expect(data[4]).toBe(PROTOCOL_VERSION);
    expect(data[5]).toBe(0x03); // Default flags (both true)
    expect(data[6]).toBe(0x00); // Token length high byte
    expect(data[7]).toBe(0x00); // Token length low byte
    expect(data.length).toBe(8);
  });

  test("handshake with auth", () => {
    const data = buildHandshake("my-secret-token");
    expect(data.slice(0, 4)).toEqual(MAGIC);
    const tokenLen = (data[6] << 8) | data[7];
    expect(tokenLen).toBe(15); // "my-secret-token".length
    expect(new TextDecoder().decode(data.slice(8))).toBe("my-secret-token");
  });

  test("handshake with custom flags", () => {
    const data = buildHandshake("", { messagepack: true, jsonFallback: false });
    expect(data[5]).toBe(0x01);
  });
});

describe("parseHandshakeResponse", () => {
  test("parse success response", () => {
    const sessionId = new Uint8Array(16).fill(0x42);
    const response = new Uint8Array([0x00, 0x01, 0x03, ...sessionId]);

    const result = parseHandshakeResponse(response);

    expect(result.status).toBe(HandshakeStatus.Success);
    expect(result.version).toBe(0x01);
    expect(result.flags.messagepack).toBe(true);
    expect(result.flags.jsonFallback).toBe(true);
    expect(result.sessionId).toEqual(sessionId);
  });

  test("parse version mismatch response", () => {
    const sessionId = new Uint8Array(16).fill(0x00);
    const response = new Uint8Array([0x01, 0x02, 0x01, ...sessionId]);

    const result = parseHandshakeResponse(response);

    expect(result.status).toBe(HandshakeStatus.VersionMismatch);
    expect(result.version).toBe(0x02);
  });

  test("parse auth failed response", () => {
    const sessionId = new Uint8Array(16).fill(0x00);
    const response = new Uint8Array([0x02, 0x01, 0x01, ...sessionId]);

    const result = parseHandshakeResponse(response);

    expect(result.status).toBe(HandshakeStatus.AuthFailed);
  });

  test("throws on too short response", () => {
    expect(() => parseHandshakeResponse(new Uint8Array([0x00, 0x01]))).toThrow("too short");
  });
});

describe("encodeMessage/decodeMessage", () => {
  test("encode MessagePack", () => {
    const msg = { type: "query", id: "123", query: "test" };
    const data = encodeMessage(msg, Encoding.MessagePack);
    expect(data instanceof Uint8Array).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  test("encode JSON", () => {
    const msg = { type: "query", id: "123", query: "test" };
    const data = encodeMessage(msg, Encoding.Json);
    const str = new TextDecoder().decode(data);
    expect(str).toContain('"type"');
    expect(str).toContain('"query"');
  });

  test("decode MessagePack", () => {
    const msg = { type: "result", id: "456", data: [1, 2, 3] };
    const encoded = encodeMessage(msg, Encoding.MessagePack);
    const decoded = decodeMessage(encoded, Encoding.MessagePack);
    expect(decoded).toEqual(msg);
  });

  test("decode JSON", () => {
    const msg = { type: "result", id: "456", data: [1, 2, 3] };
    const encoded = encodeMessage(msg, Encoding.Json);
    const decoded = decodeMessage(encoded, Encoding.Json);
    expect(decoded).toEqual(msg);
  });

  test("roundtrip MessagePack", () => {
    const msg = {
      type: "insert",
      id: "req-1",
      collection: "users",
      data: { name: "Alice", age: 30, active: true },
    };
    const encoded = encodeMessage(msg, Encoding.MessagePack);
    const decoded = decodeMessage(encoded, Encoding.MessagePack);
    expect(decoded).toEqual(msg);
  });

  test("roundtrip JSON", () => {
    const msg = {
      type: "insert",
      id: "req-1",
      collection: "users",
      data: { name: "Alice", age: 30, active: true },
    };
    const encoded = encodeMessage(msg, Encoding.Json);
    const decoded = decodeMessage(encoded, Encoding.Json);
    expect(decoded).toEqual(msg);
  });
});

describe("buildFrame", () => {
  test("frame structure", () => {
    const payload = new TextEncoder().encode("test payload");
    const frame = buildFrame(MessageType.Request, Encoding.MessagePack, payload);

    // Length should be payload + 2 (type + encoding)
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const length = view.getUint32(0, false);
    expect(length).toBe(payload.length + 2);

    // Message type
    expect(frame[4]).toBe(MessageType.Request);

    // Encoding
    expect(frame[5]).toBe(Encoding.MessagePack);

    // Payload
    expect(frame.slice(6)).toEqual(payload);
  });

  test("frame with response type", () => {
    const payload = new TextEncoder().encode("response data");
    const frame = buildFrame(MessageType.Response, Encoding.Json, payload);

    expect(frame[4]).toBe(MessageType.Response);
    expect(frame[5]).toBe(Encoding.Json);
  });

  test("frame with notification type", () => {
    const payload = new TextEncoder().encode("notification");
    const frame = buildFrame(MessageType.Notification, Encoding.MessagePack, payload);

    expect(frame[4]).toBe(MessageType.Notification);
  });
});

describe("parseFrameHeader", () => {
  test("parse request header", () => {
    // Length=14 (12 payload + 2), type=REQUEST, encoding=MESSAGEPACK
    const header = new Uint8Array([0x00, 0x00, 0x00, 0x0e, 0x01, 0x01]);
    const result = parseFrameHeader(header);

    expect(result.payloadLength).toBe(12);
    expect(result.msgType).toBe(MessageType.Request);
    expect(result.encoding).toBe(Encoding.MessagePack);
  });

  test("parse response header", () => {
    // Length=34, type=RESPONSE, encoding=JSON
    const header = new Uint8Array([0x00, 0x00, 0x00, 0x22, 0x02, 0x02]);
    const result = parseFrameHeader(header);

    expect(result.payloadLength).toBe(32);
    expect(result.msgType).toBe(MessageType.Response);
    expect(result.encoding).toBe(Encoding.Json);
  });

  test("parse notification header", () => {
    // Length=258, type=NOTIFICATION, encoding=MSGPACK
    const header = new Uint8Array([0x00, 0x00, 0x01, 0x02, 0x03, 0x01]);
    const result = parseFrameHeader(header);

    expect(result.payloadLength).toBe(256);
    expect(result.msgType).toBe(MessageType.Notification);
  });

  test("throws on too short header", () => {
    expect(() => parseFrameHeader(new Uint8Array([0x00, 0x00, 0x00]))).toThrow("too short");
  });
});

describe("uuidToString", () => {
  test("converts bytes to UUID string format", () => {
    const bytes = new Uint8Array([
      0x55, 0x0e, 0x84, 0x00,
      0xe2, 0x9b,
      0x41, 0xd4,
      0xa7, 0x16,
      0x44, 0x66, 0x55, 0x44, 0x00, 0x00
    ]);
    const uuid = uuidToString(bytes);
    expect(uuid).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  test("handles all zeros", () => {
    const bytes = new Uint8Array(16).fill(0x00);
    const uuid = uuidToString(bytes);
    expect(uuid).toBe("00000000-0000-0000-0000-000000000000");
  });

  test("handles all 0xff", () => {
    const bytes = new Uint8Array(16).fill(0xff);
    const uuid = uuidToString(bytes);
    expect(uuid).toBe("ffffffff-ffff-ffff-ffff-ffffffffffff");
  });
});

describe("Full Frame Roundtrip", () => {
  test("frame roundtrip MessagePack", () => {
    const msg = { type: "query", id: "test-123", query: 'db.table("users").run()' };

    // Encode message
    const payload = encodeMessage(msg, Encoding.MessagePack);

    // Build frame
    const frame = buildFrame(MessageType.Request, Encoding.MessagePack, payload);

    // Parse header
    const { payloadLength, msgType, encoding } = parseFrameHeader(frame.slice(0, 6));

    // Extract and decode payload
    const extractedPayload = frame.slice(6, 6 + payloadLength);
    const decoded = decodeMessage(extractedPayload, encoding);

    expect(msgType).toBe(MessageType.Request);
    expect(encoding).toBe(Encoding.MessagePack);
    expect(decoded).toEqual(msg);
  });

  test("frame roundtrip JSON", () => {
    const msg = { type: "result", id: "resp-456", data: { count: 42 } };

    const payload = encodeMessage(msg, Encoding.Json);
    const frame = buildFrame(MessageType.Response, Encoding.Json, payload);
    const { payloadLength, msgType, encoding } = parseFrameHeader(frame.slice(0, 6));
    const extractedPayload = frame.slice(6, 6 + payloadLength);
    const decoded = decodeMessage(extractedPayload, encoding);

    expect(msgType).toBe(MessageType.Response);
    expect(encoding).toBe(Encoding.Json);
    expect(decoded).toEqual(msg);
  });
});
