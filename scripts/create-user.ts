import { db } from "../server/db.js";
import { createUser } from "../server/auth.js";
if (!process.env.NEW_USER_PASSWORD)
  throw new Error(
    "Set NEW_USER_PASSWORD securely; do not pass passwords as CLI arguments.",
  );
await createUser(
  db(),
  process.argv[2] || "dima",
  process.env.NEW_USER_PASSWORD,
  process.argv[3],
);
console.log("User created.");
process.exit(0);
