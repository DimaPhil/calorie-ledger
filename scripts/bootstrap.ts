import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createUser } from "../server/auth.js";
import { db } from "../server/db.js";
const password = randomBytes(24).toString("base64url");
await mkdir(".local", { recursive: true, mode: 0o700 });
await createUser(db(), "dima", password);
await writeFile(
  ".local/access.md",
  `# Calorie Ledger access\n\nUsername: dima\n\nInitial password: ${password}\n\nSign in, change the password in Settings, and create a separate token for each agent. Keep this file private; it is ignored by Git.\n`,
  { mode: 0o600, flag: "wx" },
);
console.log(
  "Initial account created; credentials saved privately to .local/access.md.",
);
process.exit(0);
