import pg from "pg";
import { randomUUID } from "node:crypto";

export interface Database {
  query<T extends Record<string, any> = Record<string, any>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null; affectedRows?: number }>;
  transaction?<T>(fn: (tx: Database) => Promise<T>): Promise<T>;
}
let database: Database | undefined;
function postgres(
  connectionString: string,
  namespace?: string,
): Database & { close(): Promise<void> } {
  const pool = new pg.Pool({
    connectionString,
    ...(namespace ? { options: `-c search_path=${namespace}` } : {}),
    max: 3,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 10000,
  });
  return {
    query: (sql, values) => pool.query(sql, values),
    close: () => pool.end(),
    async transaction<T>(fn: (tx: Database) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({
          query: (sql, values) => client.query(sql, values),
        });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
export function db(): Database {
  if (!database) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    database = postgres(process.env.DATABASE_URL);
  }
  return database;
}
export async function testDatabase(): Promise<
  Database & { close(): Promise<void> }
> {
  if (process.env.TEST_DATABASE_URL) {
    const url = new URL(process.env.TEST_DATABASE_URL);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      throw new Error("Tests require a local disposable PostgreSQL database.");
    const admin = postgres(process.env.TEST_DATABASE_URL);
    const namespace = "test_" + randomUUID().replaceAll("-", "");
    await admin.query(`CREATE SCHEMA ${namespace}`);
    const instance = postgres(process.env.TEST_DATABASE_URL, namespace);
    await instance.query(schema);
    return {
      ...instance,
      async close() {
        await instance.close();
        await admin.query(`DROP SCHEMA ${namespace} CASCADE`);
        await admin.close();
      },
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const instance = new PGlite();
  await instance.exec(schema);
  return instance as unknown as Database & { close(): Promise<void> };
}
export const schema = `
CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, username text NOT NULL UNIQUE, password_hash text NOT NULL,
 timezone text NOT NULL DEFAULT 'America/Los_Angeles', unit_system text NOT NULL DEFAULT 'metric',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS api_tokens (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL, token_hash text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
 last_used_at timestamptz, expires_at timestamptz NOT NULL DEFAULT now() + interval '365 days'
);
CREATE TABLE IF NOT EXISTS products (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id, id)
);
CREATE TABLE IF NOT EXISTS dishes (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS choices (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, query text NOT NULL,
 product_id uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id, query),
 FOREIGN KEY(user_id, product_id) REFERENCES products(user_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS entries (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 date date NOT NULL, data jsonb NOT NULL, idempotency_key text NOT NULL, request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id, idempotency_key)
);
ALTER TABLE entries ADD COLUMN IF NOT EXISTS deleted boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS entries_user_date ON entries(user_id, date);
CREATE INDEX IF NOT EXISTS products_user ON products(user_id);
CREATE INDEX IF NOT EXISTS dishes_user ON dishes(user_id);
CREATE TABLE IF NOT EXISTS rate_limits (
 key text PRIMARY KEY, count integer NOT NULL, resets_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS search_cache (
 query text PRIMARY KEY, data jsonb NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_clients (
 id text PRIMARY KEY, data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_requests (
 id text PRIMARY KEY, client_id text NOT NULL REFERENCES oauth_clients(id),
 data jsonb NOT NULL, csrf_hash text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_codes (
 code_hash text PRIMARY KEY, client_id text NOT NULL REFERENCES oauth_clients(id),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 data jsonb NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_grants (
 id uuid PRIMARY KEY REFERENCES api_tokens(id) ON DELETE CASCADE,
 client_id text NOT NULL REFERENCES oauth_clients(id), resource text NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_tokens (
 token_hash text PRIMARY KEY, grant_id uuid NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('access','refresh')), used boolean NOT NULL DEFAULT false,
 expires_at timestamptz NOT NULL
);
`;
