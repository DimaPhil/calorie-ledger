import {
  randomBytes,
  randomUUID,
  scrypt as scryptCb,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import type { Request } from "express";
import type { Database } from "./db.js";
import { AppError } from "./nutrition.js";
import type { User } from "../src/shared.js";
const scrypt = promisify(scryptCb);
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}
export async function passwordMatches(password: string, saved: string) {
  const [salt, digest] = saved.split(":");
  const computed = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(digest, "hex");
  return (
    expected.length === computed.length && timingSafeEqual(computed, expected)
  );
}
export function publicUser(row: any): User {
  return {
    id: row.id,
    username: row.username,
    timezone: row.timezone,
    unitSystem: row.unit_system,
  };
}
export async function createUser(
  database: Database,
  username: string,
  password: string,
  timezone = "America/Los_Angeles",
) {
  if (
    !/^[a-zA-Z0-9_.-]{2,60}$/.test(username) ||
    password.length < 14 ||
    password.length > 256
  )
    throw new AppError(
      "invalid_credentials",
      "Use a username of 2–60 letters, numbers, dots, underscores or hyphens and a password of at least 14 characters.",
    );
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    throw new AppError("invalid_timezone", "Choose a valid IANA timezone.");
  }
  const id = randomUUID();
  await database.query(
    "INSERT INTO users(id, username, password_hash, timezone) VALUES($1, $2, $3, $4)",
    [id, username.toLowerCase(), await passwordHash(password), timezone],
  );
  return id;
}
export async function limit(
  database: Database,
  key: string,
  max: number,
  seconds = 60,
) {
  const { rows } = await database.query(
    `INSERT INTO rate_limits(key, count, resets_at) VALUES($1, 1, now() + ($2 * interval '1 second'))
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN rate_limits.resets_at < now() THEN 1 ELSE rate_limits.count + 1 END,
    resets_at = CASE WHEN rate_limits.resets_at < now() THEN now() + ($2 * interval '1 second') ELSE rate_limits.resets_at END RETURNING count`,
    [key, seconds],
  );
  if (rows[0].count > max)
    throw new AppError(
      "rate_limited",
      "Too many requests. Please wait a minute and retry.",
      429,
    );
}
export async function login(
  database: Database,
  username: string,
  password: string,
) {
  await limit(database, `login:${hash(username.toLowerCase())}`, 10, 600);
  const { rows } = await database.query(
    "SELECT * FROM users WHERE username = $1",
    [username.toLowerCase()],
  );
  const dummy = "00000000000000000000000000000000:" + "00".repeat(64);
  const valid = await passwordMatches(
    password,
    rows[0]?.password_hash || dummy,
  );
  if (!valid || !rows[0])
    throw new AppError(
      "invalid_login",
      "Username or password is incorrect.",
      401,
    );
  const token = randomBytes(32).toString("base64url");
  await database.query("DELETE FROM sessions WHERE expires_at < now()");
  await database.query(
    `INSERT INTO sessions(token_hash, user_id, expires_at) VALUES($1,$2,now() + interval '7 days')`,
    [hash(token), rows[0].id],
  );
  return { token, user: publicUser(rows[0]) };
}
export async function authenticate(
  database: Database,
  req: Request,
  tokenOnly = false,
): Promise<User> {
  const bearer = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
  if (bearer) {
    const { rows } = await database.query(
      `SELECT u.* FROM users u JOIN api_tokens t ON u.id=t.user_id WHERE t.token_hash=$1 AND t.expires_at>now()`,
      [hash(bearer)],
    );
    if (rows[0]) {
      await database.query(
        "UPDATE api_tokens SET last_used_at=now() WHERE token_hash=$1",
        [hash(bearer)],
      );
      return publicUser(rows[0]);
    }
  } else if (!tokenOnly && req.cookies?.session) {
    const { rows } = await database.query(
      `SELECT u.* FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`,
      [hash(req.cookies.session)],
    );
    if (rows[0]) return publicUser(rows[0]);
  }
  throw new AppError(
    "unauthorized",
    "Sign in or supply a valid API bearer token.",
    401,
  );
}
