import { db, schema } from "../server/db.js";
await db().query(schema);
console.log("Database schema ready.");
process.exit(0);
