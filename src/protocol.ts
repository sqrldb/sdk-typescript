/**
 * Wire protocol types and constants for SquirrelDB TCP connections.
 */

import { pack, unpack } from "msgpackr";

// Protocol constants
export const MAGIC = new Uint8Array([0x53, 0x51, 0x52, 0x4c]); // "SQRL"
export const PROTOCOL_VERSION = 0x01;
export const MAX_MESSAGE_SIZE = 16 * 1024 * 1024; // 16MB

// Handshake status codes
export enum HandshakeStatus {
  Success = 0x00,
  VersionMismatch = 0x01,
  AuthFailed = 0x02,
}

// Message types
export enum MessageType {
  Request = 0x01,
  Response = 0x02,
  Notification = 0x03,
}

// Encoding formats
export enum Encoding {
  MessagePack = 0x01,
  Json = 0x02,
}

// Protocol flags
export interface ProtocolFlags {
  messagepack: boolean;
  jsonFallback: boolean;
}

export function flagsToByte(flags: ProtocolFlags): number {
  let byte = 0;
  if (flags.messagepack) byte |= 0x01;
  if (flags.jsonFallback) byte |= 0x02;
  return byte;
}

export function byteToFlags(byte: number): ProtocolFlags {
  return {
    messagepack: (byte & 0x01) !== 0,
    jsonFallback: (byte & 0x02) !== 0,
  };
}

/**
 * Build handshake packet to send to server.
 */
export function buildHandshake(
  authToken: string = "",
  flags: ProtocolFlags = { messagepack: true, jsonFallback: true }
): Uint8Array {
  const tokenBytes = new TextEncoder().encode(authToken);

  const buffer = new ArrayBuffer(8 + tokenBytes.length);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // Magic
  bytes.set(MAGIC, 0);
  // Version
  view.setUint8(4, PROTOCOL_VERSION);
  // Flags
  view.setUint8(5, flagsToByte(flags));
  // Token length (big-endian)
  view.setUint16(6, tokenBytes.length, false);
  // Token
  bytes.set(tokenBytes, 8);

  return bytes;
}

/**
 * Parse handshake response from server.
 */
export function parseHandshakeResponse(data: Uint8Array): {
  status: HandshakeStatus;
  version: number;
  flags: ProtocolFlags;
  sessionId: Uint8Array;
} {
  if (data.length < 19) {
    throw new Error(`Handshake response too short: ${data.length} bytes`);
  }

  return {
    status: data[0] as HandshakeStatus,
    version: data[1],
    flags: byteToFlags(data[2]),
    sessionId: data.slice(3, 19),
  };
}

/**
 * Encode a message using the specified encoding.
 */
export function encodeMessage(msg: unknown, encoding: Encoding): Uint8Array {
  if (encoding === Encoding.MessagePack) {
    return pack(msg);
  } else {
    return new TextEncoder().encode(JSON.stringify(msg));
  }
}

/**
 * Decode a message using the specified encoding.
 */
export function decodeMessage<T = unknown>(data: Uint8Array, encoding: Encoding): T {
  if (encoding === Encoding.MessagePack) {
    return unpack(data) as T;
  } else {
    return JSON.parse(new TextDecoder().decode(data)) as T;
  }
}

/**
 * Build a framed message.
 */
export function buildFrame(
  msgType: MessageType,
  encoding: Encoding,
  payload: Uint8Array
): Uint8Array {
  const length = payload.length + 2; // +2 for type and encoding bytes

  const buffer = new ArrayBuffer(6 + payload.length);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // Length (big-endian)
  view.setUint32(0, length, false);
  // Message type
  view.setUint8(4, msgType);
  // Encoding
  view.setUint8(5, encoding);
  // Payload
  bytes.set(payload, 6);

  return bytes;
}

/**
 * Parse frame header.
 */
export function parseFrameHeader(data: Uint8Array): {
  payloadLength: number;
  msgType: MessageType;
  encoding: Encoding;
} {
  if (data.length < 6) {
    throw new Error(`Frame header too short: ${data.length} bytes`);
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const length = view.getUint32(0, false);
  const payloadLength = length - 2;

  return {
    payloadLength,
    msgType: data[4] as MessageType,
    encoding: data[5] as Encoding,
  };
}

/**
 * Convert UUID bytes to string.
 */
export function uuidToString(bytes: Uint8Array): string {
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
