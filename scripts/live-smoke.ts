import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { db } from "../server/db.js";
import { createUser } from "../server/auth.js";
import type { Product, Dish, Stats } from "../src/shared.js";

// Explicit acceptance test: creates one temporary account, then deletes only that
// account and its records. Requires an operator-provided target and database URL.
const target = new URL(process.argv[2]);
if (target.protocol !== "https:" || !process.env.DATABASE_URL)
  throw new Error("Pass the HTTPS deployment URL and its DATABASE_URL.");
const username = "qa_" + randomBytes(6).toString("hex");
const password = randomBytes(24).toString("base64url");
const id = await createUser(db(), username, password);
let cookie = "";
const client = new Client({
  name: "calorie-ledger-live-acceptance",
  version: "1.0.0",
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(new URL(path, target), {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: target.origin,
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(response.ok, true, `${path} returned ${response.status}`);
  if (path === "/api/login")
    cookie = response.headers.get("set-cookie")!.split(";")[0];
  return response.json();
}
async function tool<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, `${name} failed`);
  return JSON.parse((result.content as { text: string }[])[0].text);
}
try {
  assert.equal((await fetch(new URL("/api/me", target))).status, 401);
  assert.equal((await fetch(new URL("/mcp", target))).status, 401);
  await call("/api/login", { username, password });
  const token = await call<{ id: string; token: string }>("/api/tokens", {
    name: "temporary acceptance",
  });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", target), {
      requestInit: { headers: { Authorization: `Bearer ${token.token}` } },
    }),
  );
  assert.equal((await client.listTools()).tools.length, 16);
  const profile = await tool<{ today: string }>("get_profile", {});
  const product = await tool<Product>("save_product", {
    product: {
      name: "Acceptance oats",
      brand: "QA",
      nutrients: {
        calories: 400,
        protein: 10,
        carbs: 60,
        fat: 8,
        sugar: 2,
        fiber: 10,
      },
      portions: [{ label: "cup", unit: "cup", grams: 80 }],
    },
  });
  const missing = await tool<{ status: string }>("resolve_food", {
    query: "Acceptance oats",
  });
  assert.equal(missing.status, "clarification_required");
  const dish = await call<Dish>("/api/actions/save_dish", {
    dish: {
      name: "Acceptance breakfast",
      ingredients: [{ productId: product.id, amount: 100, unit: "g" }],
      servings: 2,
    },
  });
  const log = {
    productId: product.id,
    amount: 50,
    unit: "g",
    date: profile.today,
    meal: "breakfast",
    idempotencyKey: randomUUID(),
  };
  await tool("log_food", log);
  assert.equal(
    (await tool<{ replayed: boolean }>("log_food", log)).replayed,
    true,
  );
  await call("/api/actions/log_food", {
    dishId: dish.id,
    amount: 1,
    unit: "serving",
    date: profile.today,
    meal: "lunch",
    idempotencyKey: randomUUID(),
  });
  const stats = await tool<Stats>("get_stats", {
    start: profile.today,
    end: profile.today,
  });
  assert.equal(stats.entries.length, 2);
  assert.equal(stats.totals.calories, 400);
  const foods = await call<{ candidates: Product[] }>(
    "/api/actions/search_products",
    { query: "cheerios" },
  );
  assert.ok(
    foods.candidates.length > 0,
    "Live food provider search returned no candidates",
  );
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1365, height: 950 },
  });
  await page.goto(target.href);
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in →" }).click();
  await page.getByText("Acceptance breakfast", { exact: true }).waitFor();
  assert.ok((await page.locator(".energy").textContent())?.includes("400"));
  await mkdir(".local", { recursive: true });
  await page.screenshot({
    path: ".local/production-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page
      .locator("body")
      .evaluate((e) => e.scrollWidth <= window.innerWidth),
    true,
  );
  await page.screenshot({
    path: ".local/production-mobile.png",
    fullPage: true,
  });
  await call("/api/tokens/revoke", { id: token.id });
  assert.equal(
    (
      await fetch(new URL("/api/me", target), {
        headers: { Authorization: `Bearer ${token.token}` },
      })
    ).status,
    401,
  );
  await writeFile(
    ".local/live-acceptance.json",
    JSON.stringify(
      {
        target: target.origin,
        checkedAt: new Date().toISOString(),
        checks: [
          "unauthenticated rejection",
          "web login",
          "MCP initialize/discovery",
          "clarification",
          "product and recipe persistence",
          "idempotent logging",
          "400 kcal stats",
          "live provider search",
          "desktop/mobile rendering",
          "token revocation",
        ],
        passed: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "Production acceptance passed: authenticated web + MCP + database + food search + responsive UI + revocation.",
  );
} finally {
  await browser?.close();
  await client.close().catch(() => {});
  await db().query("DELETE FROM users WHERE id=$1", [id]);
}
process.exit(0);
