import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { createHash } from "node:crypto";
import { createApp } from "../server/app.js";
import { testDatabase } from "../server/db.js";
import { createUser, hash } from "../server/auth.js";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { Server } from "node:http";
const origin = "http://127.0.0.1:3999",
  resource = `${origin}/mcp`,
  callback = "https://claude.ai/api/mcp/auth_callback";
const verifier = "a".repeat(43),
  challenge = createHash("sha256").update(verifier).digest("base64url");
let db: Awaited<ReturnType<typeof testDatabase>>,
  app: ReturnType<typeof createApp>,
  clientId: string,
  server: Server;
beforeAll(async () => {
  process.env.APP_URL = origin;
  db = await testDatabase();
  await createUser(db, "alice", "alice-password-12345");
  await createUser(db, "bob", "bob-password-1234567");
  app = createApp(db, async () => ({ products: [], warnings: [] }));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const registered = await request(app)
    .post("/register")
    .send({
      client_name: "Claude test <unsafe>",
      redirect_uris: [callback],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  expect(registered.status).toBe(201);
  clientId = registered.body.client_id;
});
afterAll(async () => {
  server.close();
  await db.close();
  delete process.env.APP_URL;
});
async function start(extra: object = {}) {
  return request(app)
    .get("/authorize")
    .query({
      client_id: clientId,
      redirect_uri: callback,
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource,
      scope: "ledger",
      state: "original-state",
      ...extra,
    });
}
async function approve(username = "alice", decision = "allow") {
  const started = await start();
  expect(started.status).toBe(303);
  const cookie = started.headers["set-cookie"][0].split(";")[0];
  const id = new URL(started.headers.location, origin).searchParams.get(
    "request",
  );
  const result = await request(app)
    .post("/oauth/consent")
    .set("Cookie", cookie)
    .set("Origin", origin)
    .type("form")
    .send({
      request: id,
      decision,
      username,
      password:
        username === "alice" ? "alice-password-12345" : "bob-password-1234567",
    });
  expect(result.status).toBe(303);
  const target = new URL(result.headers.location);
  expect(target.searchParams.get("state")).toBe("original-state");
  expect(target.searchParams.get("iss")).toBe(origin);
  return { code: target.searchParams.get("code"), target, cookie, id, result };
}
const exchange = (code: string | null, extra: object = {}) =>
  request(app)
    .post("/token")
    .type("form")
    .send({
      client_id: clientId,
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: callback,
      resource,
      ...extra,
    });
const refresh = (token: string, extra: object = {}) =>
  request(app)
    .post("/token")
    .type("form")
    .send({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: token,
      resource,
      ...extra,
    });
async function access(username = "alice") {
  const { code } = await approve(username);
  const response = await exchange(code);
  expect(response.status).toBe(200);
  return response.body;
}
const call = (token: string, name = "get_profile", args = {}) =>
  request(app)
    .post("/mcp")
    .set("Authorization", `Bearer ${token}`)
    .set("Accept", "application/json, text/event-stream")
    .set("MCP-Protocol-Version", "2026-07-28")
    .set("Mcp-Method", "tools/call")
    .set("Mcp-Name", name)
    .send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name,
        arguments: args,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    });
describe("OAuth connector", () => {
  it("advertises resource discovery, public registration, S256 and issuer identification", async () => {
    const unauth = await request(app).post("/mcp").send({});
    expect(unauth.status).toBe(401);
    expect(unauth.headers["www-authenticate"]).toContain(
      `${origin}/.well-known/oauth-protected-resource/mcp`,
    );
    const metadata = await request(app).get(
      "/.well-known/oauth-protected-resource/mcp",
    );
    expect(metadata.body.resource).toBe(resource);
    expect(metadata.body.authorization_servers).toEqual([origin]);
    const auth = await request(app).get(
      "/.well-known/oauth-authorization-server",
    );
    expect(auth.body).toMatchObject({
      issuer: origin,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      authorization_response_iss_parameter_supported: true,
    });
    const registered = await request(app)
      .post("/register")
      .send({ redirect_uris: ["http://127.0.0.1:3210/callback"] });
    expect(registered.status).toBe(201);
    expect(registered.body.client_secret).toBeUndefined();
    for (const redirect of [
      "http://evil.test/callback",
      "https://evil.test/callback#fragment",
      "https://u:p@evil.test/",
    ])
      expect(
        (
          await request(app)
            .post("/register")
            .send({ redirect_uris: [redirect] })
        ).status,
      ).toBe(400);
    expect(
      (
        await request(app)
          .post("/register")
          .send({
            redirect_uris: [callback],
            token_endpoint_auth_method: "client_secret_post",
          })
      ).status,
    ).toBe(400);
  });
  it("requires registered redirects, resource, scope, S256 and browser-bound consent", async () => {
    expect((await start({ redirect_uri: "https://evil.test/" })).status).toBe(
      400,
    );
    expect((await start({ client_id: "unregistered" })).status).toBe(400);
    for (const extra of [
      { resource: "https://evil.test/mcp" },
      { scope: "admin" },
      { code_challenge_method: "plain" },
      { code_challenge: "bad" },
    ]) {
      const res = await start(extra);
      expect(res.status).toBe(302);
      expect(new URL(res.headers.location).searchParams.has("error")).toBe(
        true,
      );
      expect(new URL(res.headers.location).searchParams.get("iss")).toBe(
        origin,
      );
    }
    const started = await start();
    const path = started.headers.location;
    expect((await request(app).get(path)).status).toBe(400);
    const cookie = started.headers["set-cookie"][0].split(";")[0];
    const page = await request(app).get(path).set("Cookie", cookie);
    expect(page.text).toContain("Claude test &lt;unsafe&gt;");
    expect(page.text).toContain("Allow access");
    expect(page.headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    const id = new URL(path, origin).searchParams.get("request");
    expect(
      (
        await request(app)
          .post("/oauth/consent")
          .set("Cookie", cookie)
          .type("form")
          .send({ request: id, decision: "allow" })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post("/oauth/consent")
          .set("Origin", origin)
          .set("Cookie", cookie)
          .type("form")
          .send({
            request: id,
            decision: "allow",
            username: "alice",
            password: "wrong",
          })
      ).status,
    ).toBe(401);
    const denied = await approve("alice", "deny");
    expect(denied.target.searchParams.get("error")).toBe("access_denied");
    expect(
      (
        await request(app)
          .post("/oauth/consent")
          .set("Cookie", denied.cookie)
          .set("Origin", origin)
          .type("form")
          .send({ request: denied.id, decision: "deny" })
      ).status,
    ).toBe(400);
  });
  it("enforces PKCE, audience, redirect binding and single-use authorization codes", async () => {
    const { code } = await approve();
    for (const extra of [
      { code_verifier: "b".repeat(43) },
      { resource: "https://evil.test/mcp" },
      { redirect_uri: "https://evil.test/" },
    ])
      expect((await exchange(code, extra)).status).toBe(400);
    const tokens = await exchange(code);
    expect(tokens.status).toBe(200);
    expect((await exchange(code)).status).toBe(400);
    expect((await call(tokens.body.access_token)).status).toBe(200);
    expect(
      (
        await request(app)
          .get("/api/me")
          .set("Authorization", `Bearer ${tokens.body.access_token}`)
      ).status,
    ).toBe(401);
    const stored = await db.query("SELECT token_hash FROM oauth_tokens");
    expect(
      stored.rows.some((r) => r.token_hash === hash(tokens.body.access_token)),
    ).toBe(true);
    expect(JSON.stringify(stored.rows)).not.toContain(tokens.body.access_token);
  });
  it("rotates refresh tokens, rejects replay and revokes the whole grant", async () => {
    const tokens = await access();
    expect(
      (await refresh(tokens.refresh_token, { scope: "admin" })).status,
    ).toBe(400);
    expect(
      (
        await refresh(tokens.refresh_token, {
          resource: "https://evil.test/mcp",
        })
      ).status,
    ).toBe(400);
    expect(
      (await refresh(tokens.refresh_token, { client_id: "bad" })).status,
    ).toBe(400);
    const next = await refresh(tokens.refresh_token);
    expect(next.status).toBe(200);
    expect(next.body.refresh_token).not.toBe(tokens.refresh_token);
    expect((await call(next.body.access_token)).status).toBe(200);
    expect((await refresh(tokens.refresh_token)).status).toBe(400);
    expect((await call(next.body.access_token)).status).toBe(401);
    expect((await refresh(next.body.refresh_token)).status).toBe(400);
  });
  it("expires tokens and supports protocol and user revocation", async () => {
    const tokens = await access();
    await db.query(
      "UPDATE oauth_tokens SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
      [hash(tokens.access_token)],
    );
    expect((await call(tokens.access_token)).status).toBe(401);
    const next = await refresh(tokens.refresh_token);
    expect(next.status).toBe(200);
    expect(
      (
        await request(app)
          .post("/revoke")
          .type("form")
          .send({ client_id: clientId, token: next.body.refresh_token })
      ).status,
    ).toBe(200);
    expect((await call(next.body.access_token)).status).toBe(401);
    const another = await access();
    const session = await request(app)
      .post("/api/login")
      .set("Origin", origin)
      .send({ username: "alice", password: "alice-password-12345" });
    const cookie = session.headers["set-cookie"][0].split(";")[0];
    const list = await request(app).get("/api/tokens").set("Cookie", cookie);
    const grant = (
      await db.query("SELECT grant_id FROM oauth_tokens WHERE token_hash=$1", [
        hash(another.access_token),
      ])
    ).rows[0].grant_id;
    expect(
      list.body.some(
        (t: { id: string; name: string }) =>
          t.id === grant && t.name.startsWith("OAuth:"),
      ),
    ).toBe(true);
    await request(app)
      .post("/api/tokens/revoke")
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ id: grant });
    expect((await call(another.access_token)).status).toBe(401);
    const started = await start();
    const csrf = started.headers["set-cookie"][0].split(";")[0];
    expect(
      (
        await request(app)
          .get(started.headers.location)
          .set("Cookie", `${csrf}; ${cookie}`)
      ).text,
    ).toContain("Signed in as");
    const consent = await request(app)
      .post("/oauth/consent")
      .set("Cookie", `${csrf}; ${cookie}`)
      .set("Origin", origin)
      .type("form")
      .send({
        request: new URL(started.headers.location, origin).searchParams.get(
          "request",
        ),
        decision: "allow",
      });
    expect(consent.status).toBe(303);
  });
  it("supports the latest MCP SDK with OAuth tokens and isolates accounts", async () => {
    const alice = await access(),
      bob = await access("bob");
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
    const client = new Client(
      { name: "modern-test", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: {
        headers: { Authorization: `Bearer ${alice.access_token}` },
      },
    });
    await client.connect(transport);
    expect(transport.protocolVersion).toBe("2026-07-28");
    expect(client.getServerVersion()?.name).toBe("calorie-ledger");
    const tools = await client.listTools();
    expect(tools.tools.some((t) => t.name === "log_food")).toBe(true);
    const result = await client.callTool({
      name: "save_product",
      arguments: {
        product: { name: "Private oats", nutrients: { calories: 300 } },
      },
    });
    expect(result.isError).not.toBe(true);
    await client.close();
    const b = await call(bob.access_token, "list_products");
    expect(b.status).toBe(200);
    expect(JSON.stringify(b.body)).not.toContain("Private oats");
    expect((await call(alice.access_token, "list_products")).text).toContain(
      "Private oats",
    );
  });
});
