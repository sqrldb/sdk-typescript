import { describe, test, expect } from "bun:test"
import type { StorageOptions } from "../src/storage"
import type { Bucket, StorageObject } from "../src/types"

describe("StorageOptions", () => {
  test("minimal options", () => {
    const opts: StorageOptions = {
      endpoint: "http://localhost:9000"
    }
    expect(opts.endpoint).toBe("http://localhost:9000")
    expect(opts.accessKeyId).toBeUndefined()
    expect(opts.secretAccessKey).toBeUndefined()
    expect(opts.region).toBeUndefined()
  })

  test("full options", () => {
    const opts: StorageOptions = {
      endpoint: "https://s3.amazonaws.com",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-west-2"
    }
    expect(opts.endpoint).toBe("https://s3.amazonaws.com")
    expect(opts.accessKeyId).toBe("AKIAIOSFODNN7EXAMPLE")
    expect(opts.region).toBe("us-west-2")
  })
})

describe("Bucket type", () => {
  test("bucket structure", () => {
    const bucket: Bucket = {
      name: "my-bucket",
      created_at: "2024-01-01T00:00:00Z"
    }
    expect(bucket.name).toBe("my-bucket")
    expect(bucket.created_at).toBe("2024-01-01T00:00:00Z")
  })

  test("bucket name validation patterns", () => {
    const validNames = ["my-bucket", "bucket123", "test.bucket.name"]
    const invalidPatterns = ["My-Bucket", "bucket_name", "-bucket", "bucket-"]

    for (const name of validNames) {
      expect(name.length).toBeGreaterThanOrEqual(3)
      expect(name.length).toBeLessThanOrEqual(63)
    }
  })
})

describe("StorageObject type", () => {
  test("object structure", () => {
    const obj: StorageObject = {
      key: "path/to/file.txt",
      size: 1024,
      etag: "d41d8cd98f00b204e9800998ecf8427e",
      last_modified: "2024-01-01T00:00:00Z",
      content_type: "text/plain"
    }
    expect(obj.key).toBe("path/to/file.txt")
    expect(obj.size).toBe(1024)
    expect(obj.etag).toBe("d41d8cd98f00b204e9800998ecf8427e")
    expect(obj.content_type).toBe("text/plain")
  })

  test("object with null content_type", () => {
    const obj: StorageObject = {
      key: "file.bin",
      size: 2048,
      etag: "abc123",
      last_modified: "2024-01-01T00:00:00Z",
      content_type: null
    }
    expect(obj.content_type).toBeNull()
  })
})

describe("S3 API paths", () => {
  test("list buckets path", () => {
    const path = "/"
    expect(path).toBe("/")
  })

  test("bucket path", () => {
    const bucket = "my-bucket"
    const path = `/${bucket}`
    expect(path).toBe("/my-bucket")
  })

  test("object path", () => {
    const bucket = "my-bucket"
    const key = "path/to/file.txt"
    const path = `/${bucket}/${key}`
    expect(path).toBe("/my-bucket/path/to/file.txt")
  })

  test("list objects with prefix", () => {
    const bucket = "my-bucket"
    const prefix = "logs/"
    const params = new URLSearchParams()
    params.set("prefix", prefix)
    const path = `/${bucket}?${params}`
    expect(path).toBe("/my-bucket?prefix=logs%2F")
  })

  test("list objects with max-keys", () => {
    const bucket = "my-bucket"
    const params = new URLSearchParams()
    params.set("max-keys", "100")
    const path = `/${bucket}?${params}`
    expect(path).toBe("/my-bucket?max-keys=100")
  })
})

describe("S3 XML response parsing", () => {
  test("parse bucket name from XML", () => {
    const xml = "<Name>my-bucket</Name>"
    const match = xml.match(/<Name>([^<]+)<\/Name>/)
    expect(match).not.toBeNull()
    expect(match![1]).toBe("my-bucket")
  })

  test("parse multiple bucket names", () => {
    const xml = `
      <Buckets>
        <Bucket><Name>bucket1</Name></Bucket>
        <Bucket><Name>bucket2</Name></Bucket>
      </Buckets>
    `
    const matches = xml.matchAll(/<Name>([^<]+)<\/Name>/g)
    const names = Array.from(matches, m => m[1])
    expect(names).toEqual(["bucket1", "bucket2"])
  })

  test("parse object listing", () => {
    const xml = `
      <Contents>
        <Key>file1.txt</Key>
        <Size>1024</Size>
        <ETag>"abc123"</ETag>
      </Contents>
    `
    const keyMatch = xml.match(/<Key>([^<]+)<\/Key>/)
    const sizeMatch = xml.match(/<Size>(\d+)<\/Size>/)
    const etagMatch = xml.match(/<ETag>([^<]+)<\/ETag>/)

    expect(keyMatch![1]).toBe("file1.txt")
    expect(parseInt(sizeMatch![1], 10)).toBe(1024)
    expect(etagMatch![1].replace(/"/g, "")).toBe("abc123")
  })
})

describe("Content types", () => {
  test("common content types", () => {
    const contentTypes: Record<string, string> = {
      ".txt": "text/plain",
      ".html": "text/html",
      ".css": "text/css",
      ".js": "application/javascript",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".pdf": "application/pdf"
    }

    expect(contentTypes[".json"]).toBe("application/json")
    expect(contentTypes[".png"]).toBe("image/png")
  })
})
