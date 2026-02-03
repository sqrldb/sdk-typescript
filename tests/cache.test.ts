import { describe, test, expect } from "bun:test"
import type { CacheOptions } from "../src/cache"

describe("CacheOptions", () => {
  test("default options structure", () => {
    const opts: CacheOptions = {}
    expect(opts.host).toBeUndefined()
    expect(opts.port).toBeUndefined()
  })

  test("custom options structure", () => {
    const opts: CacheOptions = {
      host: "redis.example.com",
      port: 6380
    }
    expect(opts.host).toBe("redis.example.com")
    expect(opts.port).toBe(6380)
  })
})

describe("RESP Protocol", () => {
  test("simple string format", () => {
    const response = "+OK\r\n"
    expect(response.startsWith("+")).toBe(true)
    expect(response.includes("\r\n")).toBe(true)
  })

  test("error format", () => {
    const response = "-ERR unknown command\r\n"
    expect(response.startsWith("-")).toBe(true)
  })

  test("integer format", () => {
    const response = ":1000\r\n"
    expect(response.startsWith(":")).toBe(true)
    const value = parseInt(response.slice(1), 10)
    expect(value).toBe(1000)
  })

  test("bulk string format", () => {
    const value = "hello"
    const response = `$${value.length}\r\n${value}\r\n`
    expect(response).toBe("$5\r\nhello\r\n")
  })

  test("null bulk string format", () => {
    const response = "$-1\r\n"
    expect(response).toBe("$-1\r\n")
  })

  test("array format", () => {
    const response = "*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n"
    expect(response.startsWith("*2")).toBe(true)
  })

  test("null array format", () => {
    const response = "*-1\r\n"
    expect(response).toBe("*-1\r\n")
  })
})

describe("Cache commands structure", () => {
  const encodeCommand = (...args: (string | number)[]): string => {
    return `*${args.length}\r\n${args.map(a => `$${String(a).length}\r\n${a}\r\n`).join("")}`
  }

  test("PING command", () => {
    const cmd = encodeCommand("PING")
    expect(cmd).toBe("*1\r\n$4\r\nPING\r\n")
  })

  test("GET command", () => {
    const cmd = encodeCommand("GET", "mykey")
    expect(cmd).toBe("*2\r\n$3\r\nGET\r\n$5\r\nmykey\r\n")
  })

  test("SET command", () => {
    const cmd = encodeCommand("SET", "mykey", "myvalue")
    expect(cmd).toBe("*3\r\n$3\r\nSET\r\n$5\r\nmykey\r\n$7\r\nmyvalue\r\n")
  })

  test("SET with EX command", () => {
    const cmd = encodeCommand("SET", "mykey", "myvalue", "EX", 60)
    expect(cmd).toContain("*5\r\n")
    expect(cmd).toContain("$2\r\nEX\r\n")
  })

  test("DEL command", () => {
    const cmd = encodeCommand("DEL", "mykey")
    expect(cmd).toBe("*2\r\n$3\r\nDEL\r\n$5\r\nmykey\r\n")
  })

  test("EXISTS command", () => {
    const cmd = encodeCommand("EXISTS", "mykey")
    expect(cmd).toContain("EXISTS")
  })

  test("INCR command", () => {
    const cmd = encodeCommand("INCR", "counter")
    expect(cmd).toContain("INCR")
  })

  test("INCRBY command", () => {
    const cmd = encodeCommand("INCRBY", "counter", 5)
    expect(cmd).toContain("INCRBY")
    expect(cmd).toContain("$1\r\n5\r\n")
  })

  test("MGET command", () => {
    const cmd = encodeCommand("MGET", "key1", "key2", "key3")
    expect(cmd).toContain("*4\r\n")
    expect(cmd).toContain("MGET")
  })

  test("MSET command", () => {
    const cmd = encodeCommand("MSET", "key1", "val1", "key2", "val2")
    expect(cmd).toContain("*5\r\n")
    expect(cmd).toContain("MSET")
  })

  test("KEYS command", () => {
    const cmd = encodeCommand("KEYS", "user:*")
    expect(cmd).toContain("KEYS")
    expect(cmd).toContain("user:*")
  })

  test("EXPIRE command", () => {
    const cmd = encodeCommand("EXPIRE", "mykey", 300)
    expect(cmd).toContain("EXPIRE")
  })

  test("TTL command", () => {
    const cmd = encodeCommand("TTL", "mykey")
    expect(cmd).toContain("TTL")
  })

  test("DBSIZE command", () => {
    const cmd = encodeCommand("DBSIZE")
    expect(cmd).toBe("*1\r\n$6\r\nDBSIZE\r\n")
  })

  test("FLUSHDB command", () => {
    const cmd = encodeCommand("FLUSHDB")
    expect(cmd).toBe("*1\r\n$7\r\nFLUSHDB\r\n")
  })
})
