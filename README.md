# SquirrelDB TypeScript SDK

Official TypeScript/JavaScript client for SquirrelDB.

## Installation

```bash
npm install squirreldb
# or
bun add squirreldb
# or
yarn add squirreldb
```

## Quick Start

```typescript
import { SquirrelDB } from "squirreldb";

const db = new SquirrelDB({
  host: "localhost",
  port: 8080,
  token: process.env.SQUIRRELDB_TOKEN
});

await db.connect();

// Insert a document
const user = await db.table("users").insert({
  name: "Alice",
  email: "alice@example.com"
});

// Query documents
const activeUsers = await db.table("users")
  .filter("u => u.status === 'active'")
  .run();

// Subscribe to changes
const subscription = await db.table("messages")
  .filter("m => m.room === 'general'")
  .changes((change) => {
    console.log("Change:", change.operation, change.newValue);
  });
```

## React Integration

```tsx
import { SquirrelDBProvider, useQuery, useSubscription } from "squirreldb/react";

function App() {
  return (
    <SquirrelDBProvider url="ws://localhost:8080" token={process.env.TOKEN}>
      <MessageList />
    </SquirrelDBProvider>
  );
}

function MessageList() {
  const { data: messages, isLoading } = useQuery(
    "messages",
    'db.table("messages").filter(m => m.room === "general").run()'
  );

  if (isLoading) return <div>Loading...</div>;
  return <div>{messages?.map(m => <Message key={m.id} {...m} />)}</div>;
}
```

## Documentation

Visit [squirreldb.com/docs/sdks](https://squirreldb.com/docs/sdks) for full documentation.

## License

Apache License 2.0 - see [LICENSE](LICENSE) for details.
