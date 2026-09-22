import { db } from "../server/db.js";
import { passwordHash } from "../server/auth.js";
const username = process.argv[2]?.toLowerCase();
const password = process.env.NEW_USER_PASSWORD;
if (!username || !password || password.length < 14 || password.length > 256)
  throw new Error(
    "Provide a username and NEW_USER_PASSWORD (14–256 characters) securely in the environment.",
  );
await db().transaction!(async (tx) => {
  const { rows } = await tx.query(
    "UPDATE users SET password_hash=$2 WHERE username=$1 RETURNING id",
    [username, await passwordHash(password)],
  );
  if (!rows[0]) throw new Error("User not found.");
  await tx.query("DELETE FROM sessions WHERE user_id=$1", [rows[0].id]);
});
console.log("Password reset; browser sessions invalidated.");
process.exit(0);
