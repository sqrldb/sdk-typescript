import { describe, test, expect } from "bun:test"
import {
  table,
  field,
  and,
  or,
  not,
  FieldExpr,
  QueryBuilder,
  type StructuredQuery,
  type FilterCondition,
} from "../src/query"

describe("FieldExpr", () => {
  test("eq creates equal condition", () => {
    const cond = field("age").eq(25)
    expect(cond).toEqual({ field: "age", operator: "$eq", value: 25 })
  })

  test("ne creates not equal condition", () => {
    const cond = field("status").ne("inactive")
    expect(cond).toEqual({ field: "status", operator: "$ne", value: "inactive" })
  })

  test("gt creates greater than condition", () => {
    const cond = field("price").gt(100)
    expect(cond).toEqual({ field: "price", operator: "$gt", value: 100 })
  })

  test("gte creates greater than or equal condition", () => {
    const cond = field("count").gte(10)
    expect(cond).toEqual({ field: "count", operator: "$gte", value: 10 })
  })

  test("lt creates less than condition", () => {
    const cond = field("age").lt(18)
    expect(cond).toEqual({ field: "age", operator: "$lt", value: 18 })
  })

  test("lte creates less than or equal condition", () => {
    const cond = field("rating").lte(5)
    expect(cond).toEqual({ field: "rating", operator: "$lte", value: 5 })
  })

  test("in creates array inclusion condition", () => {
    const cond = field("role").in(["admin", "mod"])
    expect(cond).toEqual({ field: "role", operator: "$in", value: ["admin", "mod"] })
  })

  test("notIn creates array exclusion condition", () => {
    const cond = field("status").notIn(["banned", "deleted"])
    expect(cond).toEqual({ field: "status", operator: "$nin", value: ["banned", "deleted"] })
  })

  test("contains creates substring condition", () => {
    const cond = field("name").contains("test")
    expect(cond).toEqual({ field: "name", operator: "$contains", value: "test" })
  })

  test("startsWith creates prefix condition", () => {
    const cond = field("email").startsWith("admin")
    expect(cond).toEqual({ field: "email", operator: "$startsWith", value: "admin" })
  })

  test("endsWith creates suffix condition", () => {
    const cond = field("email").endsWith(".com")
    expect(cond).toEqual({ field: "email", operator: "$endsWith", value: ".com" })
  })

  test("exists creates existence condition", () => {
    const cond = field("avatar").exists()
    expect(cond).toEqual({ field: "avatar", operator: "$exists", value: true })
  })

  test("exists(false) creates non-existence condition", () => {
    const cond = field("deleted_at").exists(false)
    expect(cond).toEqual({ field: "deleted_at", operator: "$exists", value: false })
  })
})

describe("QueryBuilder", () => {
  test("table creates new query builder", () => {
    const query = table("users")
    expect(query).toBeInstanceOf(QueryBuilder)
  })

  test("compiles minimal query", () => {
    const result = table("users").compileStructured()
    expect(result).toEqual({ table: "users" })
  })

  test("find with callback adds filter", () => {
    const result = table("users")
      .find(doc => doc.age.gt(21))
      .compileStructured()

    expect(result.table).toBe("users")
    expect(result.filter).toEqual({ age: { "$gt": 21 } })
  })

  test("find with direct condition", () => {
    const result = table("users")
      .find({ field: "active", operator: "$eq", value: true })
      .compileStructured()

    expect(result.filter).toEqual({ active: { "$eq": true } })
  })

  test("find with array of conditions", () => {
    const result = table("users")
      .find([
        { field: "age", operator: "$gte", value: 18 },
        { field: "age", operator: "$lte", value: 65 }
      ])
      .compileStructured()

    expect(result.filter).toEqual({
      age: { "$gte": 18, "$lte": 65 }
    })
  })

  test("sort adds sort specification", () => {
    const result = table("users")
      .sort("name")
      .compileStructured()

    expect(result.sort).toEqual([{ field: "name", direction: "asc" }])
  })

  test("sort with desc direction", () => {
    const result = table("users")
      .sort("created_at", "desc")
      .compileStructured()

    expect(result.sort).toEqual([{ field: "created_at", direction: "desc" }])
  })

  test("multiple sorts", () => {
    const result = table("posts")
      .sort("pinned", "desc")
      .sort("created_at", "desc")
      .compileStructured()

    expect(result.sort).toEqual([
      { field: "pinned", direction: "desc" },
      { field: "created_at", direction: "desc" }
    ])
  })

  test("limit sets max results", () => {
    const result = table("users")
      .limit(10)
      .compileStructured()

    expect(result.limit).toBe(10)
  })

  test("skip sets offset", () => {
    const result = table("users")
      .skip(20)
      .compileStructured()

    expect(result.skip).toBe(20)
  })

  test("changes enables subscription", () => {
    const result = table("messages")
      .changes()
      .compileStructured()

    expect(result.changes).toEqual({ includeInitial: true })
  })

  test("changes with options", () => {
    const result = table("messages")
      .changes({ includeInitial: false })
      .compileStructured()

    expect(result.changes).toEqual({ includeInitial: false })
  })

  test("full query with all options", () => {
    const result = table("users")
      .find(doc => doc.age.gte(18))
      .find(doc => doc.status.eq("active"))
      .sort("name", "asc")
      .limit(50)
      .skip(100)
      .compileStructured()

    expect(result).toEqual({
      table: "users",
      filter: {
        age: { "$gte": 18 },
        status: { "$eq": "active" }
      },
      sort: [{ field: "name", direction: "asc" }],
      limit: 50,
      skip: 100
    })
  })

  test("compile returns JSON string", () => {
    const result = table("users").limit(10).compile()
    expect(typeof result).toBe("string")
    expect(JSON.parse(result)).toEqual({ table: "users", limit: 10 })
  })
})

describe("Logical operators", () => {
  test("and combines conditions", () => {
    const cond = and(
      field("age").gte(18),
      field("active").eq(true)
    )

    expect(cond.field).toBe("$and")
    expect(cond.operator).toBe("$and")
    expect(Array.isArray(cond.value)).toBe(true)
    expect((cond.value as FilterCondition[]).length).toBe(2)
  })

  test("or combines conditions", () => {
    const cond = or(
      field("role").eq("admin"),
      field("role").eq("moderator")
    )

    expect(cond.field).toBe("$or")
    expect(cond.operator).toBe("$or")
  })

  test("not negates condition", () => {
    const cond = not(field("banned").eq(true))

    expect(cond.field).toBe("$not")
    expect(cond.operator).toBe("$not")
  })
})
