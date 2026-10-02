import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { testDatabase } from "../server/db.js";
import { createUser } from "../server/auth.js";
import { Service } from "../server/service.js";
import { exportAccount } from "../server/export.js";
import { defaultGoals } from "../src/goals-shared.js";
import { analysisPrompt } from "../src/analysis-prompt.js";
import type { User } from "../src/shared.js";

let database: Awaited<ReturnType<typeof testDatabase>>,
  user: User,
  service: Service;
let firstEntryId: string;
beforeAll(async () => {
  database = await testDatabase();
  user = {
    id: await createUser(database, "export-owner", "never-export-password-123"),
    username: "export-owner",
    timezone: "America/Los_Angeles",
    unitSystem: "metric",
  };
  service = new Service(database, user);
  const product = await service.run("save_product", {
    product: {
      name: 'Яблоко, "свежее"',
      notes: "  =SUM(A1)\n<script>alert(1)</script>|line",
      nutrients: { calories: 50, protein: 0, fiber: 2 },
      portions: [{ label: "piece", unit: "piece", grams: 100 }],
    },
  });
  const first = await service.run("log_food", {
    productId: product.id,
    amount: 100,
    unit: "g",
    date: "2024-01-01",
    query: "apple",
    idempotencyKey: randomUUID(),
  });
  firstEntryId = first.entry.id;
  const partial = await service.run("save_product", {
    product: { name: "Unknown fiber", nutrients: { calories: 20, protein: 0 } },
  });
  await service.run("log_food", {
    productId: partial.id,
    amount: 100,
    unit: "g",
    date: "2024-01-01",
    idempotencyKey: randomUUID(),
  });
  const deleted = await service.run("log_food", {
    productId: product.id,
    amount: 100,
    unit: "g",
    date: "2023-01-01",
    notes: "DELETED_RECORD",
    idempotencyKey: randomUUID(),
  });
  await service.run("delete_entry", { id: deleted.entry.id });
  const dish = await service.run("save_dish", {
    dish: {
      name: "Яблочное блюдо",
      ingredients: [{ productId: product.id, amount: 2, unit: "piece" }],
      servings: 2,
    },
  });
  await service.run("log_food", {
    dishId: dish.id,
    amount: 1,
    unit: "serving",
    date: "2024-01-02",
    idempotencyKey: randomUUID(),
  });
  await service.run("save_goals", {
    effectiveDate: "2024-01-02",
    targets: { ...defaultGoals, calories: 1800 },
  });
  await service.run("save_checkin", {
    date: "2024-01-01",
    complete: true,
    beverages: 0,
    weight: 95,
  });
  await service.run("save_checkin", {
    date: "2023-12-25",
    complete: false,
    sleep: 0,
  });
  // Long history must bypass the interactive journal's bounded date range.
  await database.query(
    `INSERT INTO entries(id,user_id,date,data,idempotency_key,request_hash)
    SELECT gen_random_uuid(),$1,DATE '2024-02-01'+n,$2::jsonb || jsonb_build_object('date',(DATE '2024-02-01'+n)::text), 'export-seed-'||n,'seed'
    FROM generate_series(0,399) n`,
    [user.id, JSON.stringify(first.entry)],
  );
  const other: User = {
    ...user,
    id: await createUser(database, "export-other", "other-password-123456"),
    username: "export-other",
  };
  const otherService = new Service(database, other);
  await otherService.run("save_product", {
    product: { name: "OTHER_USER_PRIVATE", nutrients: { calories: 1 } },
  });
  await database.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
    ["SESSION_SECRET_NEVER_EXPORT", user.id],
  );
});
afterAll(async () => {
  await database.close();
});

function unpack(
  body: Buffer | string,
): Record<string, Record<string, string>[] | string> {
  const result = spawnSync(
    "python3",
    [
      "-c",
      `import sys,io,zipfile,csv,json
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
assert z.testzip() is None
print(json.dumps({n: list(csv.DictReader(io.StringIO(z.read(n).decode('utf-8')))) if n.endswith('.csv') else z.read(n).decode('utf-8') for n in z.namelist()}))`,
    ],
    { input: body, maxBuffer: 16 * 1024 * 1024 },
  );
  expect(result.status, result.stderr.toString()).toBe(0);
  return JSON.parse(result.stdout.toString());
}
it("exports all history, coverage, targets and source data in a valid CSV ZIP", async () => {
  const exported = await exportAccount(database, user, "csv");
  expect(exported.contentType).toBe("application/zip");
  expect(exported.filename).toMatch(/\.zip$/);
  const files = unpack(exported.body);
  expect(Object.keys(files)).toHaveLength(13);
  expect(files["AI_ANALYSIS_PROMPT.md"]).toBe(analysisPrompt);
  const daily = files["daily.csv"] as Record<string, string>[];
  expect(daily).toHaveLength(403);
  const incomplete = daily.find((row) => row.date === "2024-01-01")!;
  expect(incomplete).toMatchObject({
    entryCount: "2",
    checkedIn: "true",
    loggingComplete: "true",
    calories: "70",
    protein: "0",
    proteinFullyKnown: "true",
    fiber: "",
    fiberKnownSubtotal: "2",
    fiberFullyKnown: "false",
    caloriesTarget: "2100",
    magnesium: "",
    magnesiumKnownSubtotal: "",
    magnesiumFullyKnown: "false",
  });
  expect(daily.find((row) => row.date === "2023-12-25")).toMatchObject({
    entryCount: "0",
    calories: "",
    caloriesKnownSubtotal: "",
    caloriesFullyKnown: "false",
    checkedIn: "true",
  });
  expect(daily.find((row) => row.date === "2024-01-02")).toMatchObject({
    caloriesTarget: "1800",
    fiber: "2",
    fiberFullyKnown: "true",
  });
  expect(daily.some((row) => row.date === "2024-01-03")).toBe(false);
  const products = files["products.csv"] as Record<string, string>[];
  expect(products.find((p) => p.name.startsWith("Яблоко"))).toMatchObject({
    name: 'Яблоко, "свежее"',
    notes: "'  =SUM(A1)\n<script>alert(1)</script>|line",
    fiberPer100g: "2",
  });
  expect(files["entry_sources.csv"]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ entryId: firstEntryId, kind: "products" }),
    ]),
  );
  expect(files["product_portions.csv"]).toHaveLength(1);
  expect(files["dish_ingredients.csv"]).toHaveLength(1);
  expect(files["goals.csv"]).toHaveLength(2);
  expect(
    (files["entries.csv"] as Record<string, string>[]).find(
      (e) => e.id === firstEntryId,
    )?.sourceInput,
  ).toContain('"productId"');
  const serialized = JSON.stringify(files);
  for (const secret of [
    "OTHER_USER_PRIVATE",
    "DELETED_RECORD",
    "SESSION_SECRET_NEVER_EXPORT",
    "never-export-password",
    "password_hash",
    "token_hash",
  ])
    expect(serialized).not.toContain(secret);
});
it("renders the same data as safe Markdown with preserved Unicode and metadata", async () => {
  const exported = await exportAccount(database, user, "markdown");
  expect(exported.contentType).toBe("text/markdown; charset=utf-8");
  expect(exported.filename).toMatch(/\.md$/);
  const body = String(exported.body);
  expect(body.startsWith(analysisPrompt)).toBe(true);
  expect(body).toContain("Яблоко");
  expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;&#124;line");
  expect(body).not.toContain("<script>");
  expect(body).toContain("## daily");
  expect(body).toContain("## entry_sources");
  expect(body).toContain("Timezone: America/Los_Angeles");
  expect(body).toContain("Absent dates and empty cells mean unknown");
});
