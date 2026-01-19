import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { SquirrelDB, type Document, type ChangeEvent } from "../src";

const TEST_URL = process.env.SQUIRRELDB_URL || "localhost:8080";

describe("SquirrelDB Client", () => {
  let db: SquirrelDB;

  beforeAll(async () => {
    db = await SquirrelDB.connect(TEST_URL);
  });

  afterAll(() => {
    db?.close();
  });

  test("ping", async () => {
    await expect(db.ping()).resolves.toBeUndefined();
  });

  test("list collections", async () => {
    const collections = await db.listCollections();
    expect(Array.isArray(collections)).toBe(true);
  });

  test("insert document", async () => {
    const doc = await db.insert("test_users", { name: "Alice", age: 30 });

    expect(doc).toBeDefined();
    expect(doc.id).toBeDefined();
    expect(doc.collection).toBe("test_users");
    expect(doc.data).toEqual({ name: "Alice", age: 30 });
    expect(doc.created_at).toBeDefined();
    expect(doc.updated_at).toBeDefined();
  });

  test("query documents", async () => {
    // Insert a document first
    await db.insert("test_query", { name: "Bob", age: 25 });

    const docs = await db.query<Document>('db.table("test_query").run()');

    expect(Array.isArray(docs)).toBe(true);
    expect(docs.length).toBeGreaterThan(0);
  });

  test("update document", async () => {
    const inserted = await db.insert("test_update", { name: "Charlie", age: 35 });
    const updated = await db.update("test_update", inserted.id, { name: "Charlie", age: 36 });

    expect(updated.id).toBe(inserted.id);
    expect(updated.data).toEqual({ name: "Charlie", age: 36 });
  });

  test("delete document", async () => {
    const inserted = await db.insert("test_delete", { name: "Dave", age: 40 });
    const deleted = await db.delete("test_delete", inserted.id);

    expect(deleted.id).toBe(inserted.id);
  });

  test("subscribe and unsubscribe", async () => {
    const changes: ChangeEvent[] = [];

    const subId = await db.subscribe('db.table("test_subscribe").changes()', (change) => {
      changes.push(change);
    });

    expect(subId).toBeDefined();
    expect(typeof subId).toBe("string");

    // Insert a document to trigger a change
    await db.insert("test_subscribe", { name: "Eve", age: 28 });

    // Wait a bit for the change to arrive
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Unsubscribe
    await db.unsubscribe(subId);

    // Should have received at least one change
    expect(changes.length).toBeGreaterThan(0);
  });
});

describe("SquirrelDB Connection", () => {
  test("connect with ws:// prefix", async () => {
    const db = await SquirrelDB.connect(`ws://${TEST_URL}`);
    await db.ping();
    db.close();
  });

  test("connect without prefix", async () => {
    const db = await SquirrelDB.connect(TEST_URL);
    await db.ping();
    db.close();
  });

  test("error on invalid query", async () => {
    const db = await SquirrelDB.connect(TEST_URL);

    await expect(db.query("invalid query")).rejects.toThrow();

    db.close();
  });
});

describe("Type definitions", () => {
  test("Document type has correct shape", async () => {
    const db = await SquirrelDB.connect(TEST_URL);
    const doc = await db.insert("test_types", { foo: "bar" });

    // TypeScript compile-time checks
    const id: string = doc.id;
    const collection: string = doc.collection;
    const data: Record<string, unknown> = doc.data;
    const createdAt: string = doc.created_at;
    const updatedAt: string = doc.updated_at;

    expect(typeof id).toBe("string");
    expect(typeof collection).toBe("string");
    expect(typeof data).toBe("object");
    expect(typeof createdAt).toBe("string");
    expect(typeof updatedAt).toBe("string");

    db.close();
  });
});
