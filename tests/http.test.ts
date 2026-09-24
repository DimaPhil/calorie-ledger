import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import request from "supertest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../server/app.js";
import { testDatabase } from "../server/db.js";
import {
  createUser,
  hash,
  passwordMatches,
  passwordHash,
} from "../server/auth.js";
import { actionSchemas } from "../src/shared.js";
import type { Server } from "node:http";
let database: Awaited<ReturnType<typeof testDatabase>>,
  app: ReturnType<typeof createApp>,
  server: Server,
  url: string,
  cookie: string,
  token: string,
  tokenId: string;
beforeAll(async () => {
  database = await testDatabase();
  await createUser(database, "tester", "test-password-12345");
  app = createApp(database, async () => ({ products: [], warnings: [] }));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.APP_URL = url;
  const response = await request(app)
    .post("/api/login")
    .set("Origin", url)
    .send({ username: "tester", password: "test-password-12345" });
  cookie = response.headers["set-cookie"][0].split(";")[0];
});
afterAll(async () => {
  delete process.env.APP_URL;
  server.close();
  await database.close();
});
describe("authentication and web API", () => {
  it("uses secure password hashing and rejects bad account credentials", async () => {
    const hashed = await passwordHash("secret");
    expect(hashed).not.toContain("secret");
    expect(await passwordMatches("secret", hashed)).toBe(true);
    expect(await passwordMatches("wrong", hashed)).toBe(false);
    await expect(createUser(database, "x", "short")).rejects.toThrow();
    await expect(
      createUser(database, "valid", "long-password-12345", "Fake/Zone"),
    ).rejects.toThrow();
  });
  it("rejects unauthenticated requests and CSRF including absent origin", async () => {
    expect((await request(app).get("/api/me")).status).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/login")
          .set("Origin", "https://evil.test")
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post("/api/actions/list_products")
          .set("Cookie", cookie)
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post("/api/login")
          .set("Origin", url)
          .send({ username: "tester", password: "wrong" })
      ).status,
    ).toBe(401);
  });
  it("reads profile, validates input, handles unknown actions", async () => {
    expect((await request(app).get("/api/health")).body).toEqual({ ok: true });
    expect(
      (await request(app).get("/api/me").set("Cookie", cookie)).body.username,
    ).toBe("tester");
    const call = (name: string, data: object) =>
      request(app)
        .post(`/api/actions/${name}`)
        .set("Origin", url)
        .set("Cookie", cookie)
        .send(data);
    expect((await call("save_product", {})).status).toBe(422);
    expect((await call("constructor", {})).status).toBe(404);
    expect((await request(app).get("/api/missing")).status).toBe(404);
    expect((await call("list_products", {})).body).toEqual([]);
  });
  it("issues only hashed, scoped tokens and forbids token self-minting", async () => {
    const minted = await request(app)
      .post("/api/tokens")
      .set("Origin", url)
      .set("Cookie", cookie)
      .send({ name: "MCP tests" });
    expect(minted.status).toBe(200);
    token = minted.body.token;
    tokenId = minted.body.id;
    const rows = await database.query(
      "SELECT token_hash FROM api_tokens WHERE id=$1",
      [tokenId],
    );
    expect(rows.rows[0].token_hash).toBe(hash(token));
    const listed = await request(app).get("/api/tokens").set("Cookie", cookie);
    expect(JSON.stringify(listed.body)).not.toContain(token);
    expect(
      (
        await request(app)
          .post("/api/tokens")
          .set("Authorization", `Bearer ${token}`)
          .send({ name: "bad" })
      ).status,
    ).toBe(403);
    expect(
      (await request(app).get("/api/me").set("Authorization", "Bearer invalid"))
        .status,
    ).toBe(401);
  });
});
describe("real MCP client pipeline", () => {
  it("authenticates, discovers tools, resolves missing input, logs, reads statistics, retries once", async () => {
    const client = new Client({ name: "test-agent", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(
      Object.keys(actionSchemas).sort(),
    );
    const resource = await client.readResource({
      uri: "calorie-ledger://guide",
    });
    expect(resource.contents[0]).toHaveProperty("text");
    const created = await client.callTool({
      name: "save_product",
      arguments: {
        product: {
          name: "MCP oats",
          nutrients: { calories: 400, protein: 10 },
        },
      },
    });
    const product = JSON.parse((created.content as { text: string }[])[0].text);
    const originalQuery = database.query.bind(database);
    const failedContext = vi
      .spyOn(database, "query")
      .mockImplementation(async (sql, values) => {
        if (sql === "SELECT data FROM checkins WHERE user_id=$1 AND date=$2")
          throw new Error("Simulated context outage");
        return originalQuery(sql, values);
      });
    try {
      const committed = await client.callTool({
        name: "save_product",
        arguments: {
          product: { name: "Context outage", nutrients: { calories: 10 } },
        },
      });
      expect(committed.isError).not.toBe(true);
      expect((committed.structuredContent as any).dailyCheckIn).toEqual({
        status: "unavailable",
        shouldAsk: false,
      });
      expect((committed.structuredContent as any).result.id).toBeTruthy();
    } finally {
      failedContext.mockRestore();
    }
    const context = (created.structuredContent as any).dailyCheckIn;
    expect(context).toMatchObject({ checkedIn: false, shouldAsk: true });
    const checked = await client.callTool({
      name: "update_checkin",
      arguments: { date: context.date, sleep: 7 },
    });
    expect((checked.structuredContent as any).dailyCheckIn).toMatchObject({
      checkedIn: true,
      shouldAsk: false,
      loggingComplete: false,
    });
    const preview = await client.callTool({
      name: "preview_food",
      arguments: { productId: product.id, amount: 50, unit: "g" },
    });
    expect((preview.structuredContent as any).result).toMatchObject({
      logged: false,
      nutrients: { calories: 200 },
    });
    expect(
      JSON.parse((preview.content as { text: string }[])[1].text).dailyCheckIn
        .checkedIn,
    ).toBe(true);
    const missing = await client.callTool({
      name: "resolve_food",
      arguments: { query: "MCP oats" },
    });
    expect(
      JSON.parse((missing.content as { text: string }[])[0].text).status,
    ).toBe("clarification_required");
    const args = {
      productId: product.id,
      amount: 50,
      unit: "g",
      date: "2026-09-22",
      idempotencyKey: "agent-retry-key-1",
    };
    const saved = await client.callTool({ name: "log_food", arguments: args });
    expect(saved.isError).not.toBe(true);
    expect(
      JSON.parse((saved.content as { text: string }[])[0].text).entry.nutrients
        .calories,
    ).toBe(200);
    const again = await client.callTool({ name: "log_food", arguments: args });
    expect(
      JSON.parse((again.content as { text: string }[])[0].text).replayed,
    ).toBe(true);
    const bad = await client.callTool({
      name: "log_food",
      arguments: {
        ...args,
        unit: "piece",
        idempotencyKey: "missing-weight-key",
      },
    });
    expect(bad.isError).toBe(true);
    expect((bad.content as { text: string }[])[0].text).toContain(
      "clarification_required",
    );
    const stats = await client.callTool({
      name: "get_stats",
      arguments: { start: "2026-09-22", end: "2026-09-22" },
    });
    expect(
      JSON.parse((stats.content as { text: string }[])[0].text).entries,
    ).toHaveLength(1);
    await client.close();
  });
  it("denies cookie-only MCP and bad browser origins; revocation takes effect", async () => {
    expect(
      (
        await request(app)
          .post("/mcp")
          .set("Cookie", cookie)
          .set("Origin", url)
          .send({})
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post("/mcp")
          .set("Authorization", `Bearer ${token}`)
          .set("Origin", "https://evil.test")
          .send({})
      ).status,
    ).toBe(403);
    await request(app)
      .post("/api/tokens/revoke")
      .set("Origin", url)
      .set("Cookie", cookie)
      .send({ id: tokenId });
    expect(
      (
        await request(app)
          .get("/api/me")
          .set("Authorization", `Bearer ${token}`)
      ).status,
    ).toBe(401);
  });
  it("logs out and expires browser access", async () => {
    await request(app)
      .post("/api/logout")
      .set("Origin", url)
      .set("Cookie", cookie)
      .send({});
    expect(
      (await request(app).get("/api/me").set("Cookie", cookie)).status,
    ).toBe(401);
  });
  it("changes passwords and invalidates every browser session", async () => {
    const login = () =>
      request(app)
        .post("/api/login")
        .set("Origin", url)
        .send({ username: "tester", password: "test-password-12345" });
    const first = await login(),
      second = await login();
    const cookies = [first, second].map(
      (r) => r.headers["set-cookie"][0].split(";")[0],
    );
    const change = (currentPassword: string) =>
      request(app)
        .post("/api/password")
        .set("Cookie", cookies[0])
        .set("Origin", url)
        .send({ currentPassword, newPassword: "new-password-12345" });
    expect((await change("wrong")).status).toBe(403);
    expect((await change("test-password-12345")).status).toBe(200);
    for (const c of cookies)
      expect((await request(app).get("/api/me").set("Cookie", c)).status).toBe(
        401,
      );
    expect((await login()).status).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/login")
          .set("Origin", url)
          .send({ username: "tester", password: "new-password-12345" })
      ).status,
    ).toBe(200);
  });
  it("rejects malformed and oversized JSON with useful client errors", async () => {
    expect(
      (
        await request(app)
          .post("/api/login")
          .set("Origin", url)
          .set("Content-Type", "application/json")
          .send("{")
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/login")
          .set("Origin", url)
          .send({ password: "a".repeat(140000) })
      ).status,
    ).toBe(413);
  });
  it("enforces account login rate limits", async () => {
    await database.query(
      "INSERT INTO rate_limits(key,count,resets_at) VALUES($1,10,now()+interval '10 minutes') ON CONFLICT(key) DO UPDATE SET count=10,resets_at=now()+interval '10 minutes'",
      ["login:" + hash("rate-user")],
    );
    const response = await request(app)
      .post("/api/login")
      .set("Origin", url)
      .send({ username: "rate-user", password: "wrong" });
    expect(response.status).toBe(429);
    expect(response.headers["retry-after"]).toBeDefined();
  });
});
