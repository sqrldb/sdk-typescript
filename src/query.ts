/**
 * Native TypeScript query builder for SquirrelDB
 * Compiles to SquirrelDB's JavaScript query syntax
 *
 * Uses MongoDB-like naming: find/sort/limit
 */

// Filter operators for type-safe queries
export type FilterOperator =
  | { $eq: unknown }
  | { $ne: unknown }
  | { $gt: number }
  | { $gte: number }
  | { $lt: number }
  | { $lte: number }
  | { $in: unknown[] }
  | { $nin: unknown[] }
  | { $contains: string }
  | { $startsWith: string }
  | { $endsWith: string }
  | { $exists: boolean }
  | { $and: FilterCondition[] }
  | { $or: FilterCondition[] }
  | { $not: FilterCondition };

export type FilterCondition = {
  [field: string]: unknown | FilterOperator;
};

export type SortDirection = "asc" | "desc";

export type SortSpec = {
  field: string;
  direction?: SortDirection;
};

/**
 * Proxy-based field accessor for intuitive filter expressions
 * Allows: doc.age.gt(21), doc.name.eq("Alice"), doc.tags.contains("admin")
 */
export class FieldExpr {
  constructor(private path: string) {}

  eq(value: unknown): FilterCondition {
    return { [this.path]: { $eq: value } };
  }

  ne(value: unknown): FilterCondition {
    return { [this.path]: { $ne: value } };
  }

  gt(value: number): FilterCondition {
    return { [this.path]: { $gt: value } };
  }

  gte(value: number): FilterCondition {
    return { [this.path]: { $gte: value } };
  }

  lt(value: number): FilterCondition {
    return { [this.path]: { $lt: value } };
  }

  lte(value: number): FilterCondition {
    return { [this.path]: { $lte: value } };
  }

  in(values: unknown[]): FilterCondition {
    return { [this.path]: { $in: values } };
  }

  notIn(values: unknown[]): FilterCondition {
    return { [this.path]: { $nin: values } };
  }

  contains(value: string): FilterCondition {
    return { [this.path]: { $contains: value } };
  }

  startsWith(value: string): FilterCondition {
    return { [this.path]: { $startsWith: value } };
  }

  endsWith(value: string): FilterCondition {
    return { [this.path]: { $endsWith: value } };
  }

  exists(value = true): FilterCondition {
    return { [this.path]: { $exists: value } };
  }
}

/**
 * Create a document proxy for field access
 * Usage: find(doc => doc.age.gt(21))
 */
export type DocProxy = {
  [field: string]: FieldExpr & DocProxy;
};

export function createDocProxy(basePath = ""): DocProxy {
  return new Proxy({} as DocProxy, {
    get(_, prop: string) {
      const path = basePath ? `${basePath}.${prop}` : prop;
      const expr = new FieldExpr(path);
      // Return a proxy that is both a FieldExpr and allows nested access
      return new Proxy(expr, {
        get(target, nestedProp: string) {
          if (nestedProp in target) {
            return (target as unknown as Record<string, unknown>)[nestedProp];
          }
          return createDocProxy(path)[nestedProp];
        },
      });
    },
  });
}

/**
 * Compile a filter condition to SquirrelDB JS syntax
 */
function compileFilter(condition: FilterCondition): string {
  const parts: string[] = [];

  for (const [field, value] of Object.entries(condition)) {
    if (field === "$and") {
      const subConditions = (value as FilterCondition[]).map(compileFilter);
      parts.push(`(${subConditions.join(" && ")})`);
    } else if (field === "$or") {
      const subConditions = (value as FilterCondition[]).map(compileFilter);
      parts.push(`(${subConditions.join(" || ")})`);
    } else if (field === "$not") {
      parts.push(`!(${compileFilter(value as FilterCondition)})`);
    } else if (typeof value === "object" && value !== null) {
      const op = value as FilterOperator;
      if ("$eq" in op) {
        parts.push(`doc.${field} === ${JSON.stringify(op.$eq)}`);
      } else if ("$ne" in op) {
        parts.push(`doc.${field} !== ${JSON.stringify(op.$ne)}`);
      } else if ("$gt" in op) {
        parts.push(`doc.${field} > ${op.$gt}`);
      } else if ("$gte" in op) {
        parts.push(`doc.${field} >= ${op.$gte}`);
      } else if ("$lt" in op) {
        parts.push(`doc.${field} < ${op.$lt}`);
      } else if ("$lte" in op) {
        parts.push(`doc.${field} <= ${op.$lte}`);
      } else if ("$in" in op) {
        parts.push(`${JSON.stringify(op.$in)}.includes(doc.${field})`);
      } else if ("$nin" in op) {
        parts.push(`!${JSON.stringify(op.$nin)}.includes(doc.${field})`);
      } else if ("$contains" in op) {
        parts.push(`doc.${field}.includes(${JSON.stringify(op.$contains)})`);
      } else if ("$startsWith" in op) {
        parts.push(`doc.${field}.startsWith(${JSON.stringify(op.$startsWith)})`);
      } else if ("$endsWith" in op) {
        parts.push(`doc.${field}.endsWith(${JSON.stringify(op.$endsWith)})`);
      } else if ("$exists" in op) {
        parts.push(op.$exists ? `doc.${field} !== undefined` : `doc.${field} === undefined`);
      } else {
        // Nested object equality
        parts.push(`doc.${field} === ${JSON.stringify(value)}`);
      }
    } else {
      // Direct equality
      parts.push(`doc.${field} === ${JSON.stringify(value)}`);
    }
  }

  return parts.join(" && ") || "true";
}

/**
 * Query builder for fluent, type-safe queries
 * Uses MongoDB-like naming: find/sort/limit
 */
export class QueryBuilder<T = unknown> {
  private tableName: string;
  private filterExpr: string | null = null;
  private sortSpecs: SortSpec[] = [];
  private limitValue: number | null = null;
  private skipValue: number | null = null;
  private isChanges = false;

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  /**
   * Find documents matching condition (callback with doc proxy)
   * Usage: .find(doc => doc.age.gt(21))
   */
  find(fn: (doc: DocProxy) => FilterCondition): QueryBuilder<T>;
  /**
   * Find documents matching condition (object)
   * Usage: .find({ age: { $gt: 21 } })
   */
  find(condition: FilterCondition): QueryBuilder<T>;
  find(arg: ((doc: DocProxy) => FilterCondition) | FilterCondition): QueryBuilder<T> {
    const condition = typeof arg === "function" ? arg(createDocProxy()) : arg;
    this.filterExpr = compileFilter(condition);
    return this;
  }

  /**
   * Sort by field(s)
   * Usage: .sort("age") or .sort("age", "desc") or .sort([{field: "age", direction: "desc"}])
   */
  sort(field: string, direction?: SortDirection): QueryBuilder<T>;
  sort(specs: SortSpec[]): QueryBuilder<T>;
  sort(arg: string | SortSpec[], direction?: SortDirection): QueryBuilder<T> {
    if (typeof arg === "string") {
      this.sortSpecs.push({ field: arg, direction: direction ?? "asc" });
    } else {
      this.sortSpecs = arg;
    }
    return this;
  }

  /**
   * Limit results
   */
  limit(n: number): QueryBuilder<T> {
    this.limitValue = n;
    return this;
  }

  /**
   * Skip results (offset)
   */
  skip(n: number): QueryBuilder<T> {
    this.skipValue = n;
    return this;
  }

  /**
   * Subscribe to changes instead of querying
   */
  changes(): QueryBuilder<T> {
    this.isChanges = true;
    return this;
  }

  /**
   * Compile to SquirrelDB JS query string
   */
  compile(): string {
    let query = `db.table("${this.tableName}")`;

    if (this.filterExpr) {
      query += `.filter(doc => ${this.filterExpr})`;
    }

    for (const spec of this.sortSpecs) {
      query += `.orderBy("${spec.field}"${spec.direction === "desc" ? ', "desc"' : ""})`;
    }

    if (this.limitValue !== null) {
      query += `.limit(${this.limitValue})`;
    }

    if (this.skipValue !== null) {
      query += `.skip(${this.skipValue})`;
    }

    if (this.isChanges) {
      query += ".changes()";
    } else {
      query += ".run()";
    }

    return query;
  }

  toString(): string {
    return this.compile();
  }
}

/**
 * Create a table query builder
 * Usage: table("users").find(doc => doc.age.gt(21)).run()
 */
export function table<T = unknown>(name: string): QueryBuilder<T> {
  return new QueryBuilder<T>(name);
}

/**
 * Logical operators for combining conditions
 */
export function and(...conditions: FilterCondition[]): FilterCondition {
  return { $and: conditions };
}

export function or(...conditions: FilterCondition[]): FilterCondition {
  return { $or: conditions };
}

export function not(condition: FilterCondition): FilterCondition {
  return { $not: condition };
}

/**
 * Shorthand field accessor
 * Usage: field("age").gt(21)
 */
export function field(name: string): FieldExpr {
  return new FieldExpr(name);
}
