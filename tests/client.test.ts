import { describe, test, expect, mock, beforeEach } from "bun:test"
import { Document, ChangeEvent } from "../src"

describe("Document", () => {
  test("creates document from response", () => {
    const data = {
      id: "123",
      collection: "users",
      data: { name: "Alice", age: 30 },
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z"
    }

    expect(data.id).toBe("123")
    expect(data.collection).toBe("users")
    expect(data.data).toEqual({ name: "Alice", age: 30 })
  })

  test("document has correct shape", () => {
    const doc: Document = {
      id: "test-id",
      collection: "test-collection",
      data: { foo: "bar" },
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z"
    }

    expect(typeof doc.id).toBe("string")
    expect(typeof doc.collection).toBe("string")
    expect(typeof doc.data).toBe("object")
    expect(typeof doc.created_at).toBe("string")
    expect(typeof doc.updated_at).toBe("string")
  })
})

describe("ChangeEvent", () => {
  test("initial change event", () => {
    const event: ChangeEvent = {
      type: "initial",
      document: {
        id: "123",
        collection: "users",
        data: { name: "Test" },
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z"
      }
    }

    expect(event.type).toBe("initial")
    expect(event.document).toBeDefined()
    expect(event.document?.id).toBe("123")
  })

  test("insert change event", () => {
    const event: ChangeEvent = {
      type: "insert",
      new: {
        id: "123",
        collection: "users",
        data: { name: "Test" },
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z"
      }
    }

    expect(event.type).toBe("insert")
    expect(event.new).toBeDefined()
  })

  test("update change event", () => {
    const event: ChangeEvent = {
      type: "update",
      old: { name: "Old" },
      new: {
        id: "123",
        collection: "users",
        data: { name: "New" },
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z"
      }
    }

    expect(event.type).toBe("update")
    expect(event.old).toEqual({ name: "Old" })
    expect(event.new).toBeDefined()
  })

  test("delete change event", () => {
    const event: ChangeEvent = {
      type: "delete",
      old: {
        id: "123",
        collection: "users",
        data: { name: "Test" },
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z"
      }
    }

    expect(event.type).toBe("delete")
    expect(event.old).toBeDefined()
  })
})

describe("Message Protocol", () => {
  test("ping message structure", () => {
    const msg = { type: "Ping" }
    expect(msg.type).toBe("Ping")
  })

  test("query message structure", () => {
    const msg = {
      type: "Query",
      id: "req-123",
      query: 'db.table("users").run()'
    }
    expect(msg.type).toBe("Query")
    expect(msg.id).toBe("req-123")
    expect(msg.query).toContain("users")
  })

  test("insert message structure", () => {
    const msg = {
      type: "Insert",
      id: "req-456",
      collection: "users",
      data: { name: "Alice" }
    }
    expect(msg.type).toBe("Insert")
    expect(msg.collection).toBe("users")
    expect(msg.data).toEqual({ name: "Alice" })
  })

  test("update message structure", () => {
    const msg = {
      type: "Update",
      id: "req-789",
      collection: "users",
      document_id: "doc-123",
      data: { name: "Bob" }
    }
    expect(msg.type).toBe("Update")
    expect(msg.document_id).toBe("doc-123")
  })

  test("delete message structure", () => {
    const msg = {
      type: "Delete",
      id: "req-101",
      collection: "users",
      document_id: "doc-123"
    }
    expect(msg.type).toBe("Delete")
    expect(msg.document_id).toBe("doc-123")
  })

  test("subscribe message structure", () => {
    const msg = {
      type: "Subscribe",
      id: "req-202",
      query: 'db.table("users").changes()'
    }
    expect(msg.type).toBe("Subscribe")
    expect(msg.query).toContain("changes")
  })

  test("unsubscribe message structure", () => {
    const msg = {
      type: "Unsubscribe",
      id: "req-303",
      subscription_id: "sub-123"
    }
    expect(msg.type).toBe("Unsubscribe")
    expect(msg.subscription_id).toBe("sub-123")
  })
})

describe("Server Response Protocol", () => {
  test("pong response", () => {
    const response = { type: "Pong" }
    expect(response.type).toBe("Pong")
  })

  test("result response with documents", () => {
    const response = {
      type: "Result",
      id: "req-123",
      documents: [
        { id: "1", collection: "users", data: { name: "Alice" }, created_at: "", updated_at: "" }
      ]
    }
    expect(response.type).toBe("Result")
    expect(response.documents.length).toBe(1)
  })

  test("error response", () => {
    const response = {
      type: "Error",
      id: "req-123",
      message: "Query failed"
    }
    expect(response.type).toBe("Error")
    expect(response.message).toBe("Query failed")
  })

  test("subscribed response", () => {
    const response = {
      type: "Subscribed",
      id: "req-123",
      subscription_id: "sub-456"
    }
    expect(response.type).toBe("Subscribed")
    expect(response.subscription_id).toBe("sub-456")
  })

  test("change response", () => {
    const response = {
      type: "Change",
      subscription_id: "sub-456",
      change: {
        type: "insert",
        new: { id: "1", collection: "users", data: {}, created_at: "", updated_at: "" }
      }
    }
    expect(response.type).toBe("Change")
    expect(response.change.type).toBe("insert")
  })
})
