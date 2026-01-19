/**
 * Basic example demonstrating SquirrelDB TypeScript TCP SDK usage.
 */

import { SquirrelDBTcp } from "../src";

async function main() {
  // Connect to SquirrelDB server via TCP
  const client = await SquirrelDBTcp.connect({
    host: "localhost",
    port: 8082,
  });
  console.log(`Connected! Session ID: ${client.getSessionId()}`);

  // Ping the server
  await client.ping();
  console.log("Ping successful!");

  // List collections
  const collections = await client.listCollections();
  console.log("Collections:", collections);

  // Insert a document
  const doc = await client.insert("users", {
    name: "Alice",
    email: "alice@example.com",
    active: true,
  });
  console.log("Inserted document:", doc);

  // Query documents
  const users = await client.queryRaw('db.table("users").filter(u => u.active).run()');
  console.log("Active users:", JSON.stringify(users, null, 2));

  // Update the document
  const updated = await client.update("users", doc.id, {
    name: "Alice Updated",
    email: "alice.updated@example.com",
    active: true,
  });
  console.log("Updated document:", updated);

  // Subscribe to changes
  console.log("\nSubscribing to user changes...");
  console.log("(Insert/update/delete users from another client to see changes)");
  console.log("Press Ctrl+C to exit.\n");

  const sub = await client.subscribe('db.table("users").changes()', (change) => {
    switch (change.type) {
      case "initial":
        console.log("Initial:", change.document);
        break;
      case "insert":
        console.log("Insert:", change.new);
        break;
      case "update":
        console.log("Update:", change.old, "->", change.new);
        break;
      case "delete":
        console.log("Delete:", change.old);
        break;
    }
  });

  // Keep the process running
  process.on("SIGINT", async () => {
    console.log("\nUnsubscribing...");
    await sub.unsubscribe();
    client.close();
    process.exit(0);
  });
}

main().catch(console.error);
