import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { testDatabase } from "../server/db.js";
import { createUser } from "../server/auth.js";
import { Service } from "../server/service.js";
import { auditProducts } from "../server/product-audit.js";
import { productSchema } from "../src/shared.js";

let database: Awaited<ReturnType<typeof testDatabase>>;
let service: Service;
beforeAll(async () => {
  database = await testDatabase();
  const id = await createUser(database, "auditor", "long-password-12345");
  service = new Service(database, {
    id,
    username: "auditor",
    timezone: "UTC",
    unitSystem: "metric",
  });
});
afterAll(async () => {
  await database.close();
});

async function change() {
  const before = productSchema.parse({
    name: "Audit food",
    nutrients: { calories: 100, protein: 10 },
  });
  const saved = await service.run("save_product", { product: before });
  return {
    id: saved.id,
    before,
    after: {
      ...before,
      nutrients: { ...before.nutrients, calories: 200, fiber: 3 },
    },
    evidence: ["https://example.com/verified-label"],
  };
}

it("preflights ownership, conflicts, validation and backup failures before changing any product", async () => {
  const first = await change();
  const second = await change();
  const plan = { username: "auditor", changes: [first, second] };
  const backup = vi.fn(async () => {});
  expect(await auditProducts(database, plan)).toMatchObject({
    mode: "dry-run",
    pending: 2,
  });
  await expect(
    auditProducts(
      database,
      {
        ...plan,
        changes: [
          first,
          { ...second, before: { ...second.before, name: "Stale" } },
        ],
      },
      { apply: true, backup },
    ),
  ).rejects.toThrow("changed since review");
  expect(backup).not.toHaveBeenCalled();
  const other = await createUser(
    database,
    "other-auditor",
    "long-password-12345",
  );
  await database.query("UPDATE products SET user_id=$1 WHERE id=$2", [
    other,
    second.id,
  ]);
  await expect(
    auditProducts(database, plan, { apply: true, backup }),
  ).rejects.toThrow("another owner");
  await expect(
    auditProducts(database, { ...plan, changes: [{ ...first, evidence: [] }] }),
  ).rejects.toThrow();
  await expect(
    auditProducts(database, { ...plan, changes: [first, first] }),
  ).rejects.toThrow("Duplicate");
  await expect(
    auditProducts(
      database,
      { ...plan, changes: [first] },
      {
        apply: true,
        backup: async () => {
          throw new Error("disk full");
        },
      },
    ),
  ).rejects.toThrow("disk full");
  expect(
    (await service.get<any>("products", first.id)).nutrients.calories,
  ).toBe(100);
});

it("backs up, updates linked entries, preserves manual and legacy entries, and supports idempotent re-run and reversal", async () => {
  const item = await change();
  const log = () =>
    service.run("log_food", {
      productId: item.id,
      amount: 100,
      unit: "g",
      date: "2026-10-02",
      idempotencyKey: randomUUID(),
    });
  const normal = (await log()).entry;
  const manual = (await log()).entry;
  const legacy = (await log()).entry;
  await service.run("update_entry", {
    id: manual.id,
    date: manual.date,
    meal: "snack",
    notes: "",
    items: [{ name: "Manual", grams: 100, nutrients: { calories: 80 } }],
    expectedRevision: 0,
  });
  await database.query("UPDATE entries SET source_input=NULL WHERE id=$1", [
    legacy.id,
  ]);
  let snapshot: any;
  const backup = vi.fn(async (value: unknown) => {
    snapshot = value;
  });
  const plan = { username: "auditor", changes: [item] };
  expect(
    await auditProducts(database, plan, { apply: true, backup }),
  ).toMatchObject({ pending: 1, linkedEntries: 1 });
  expect(snapshot.linkedEntries[0].data.nutrients.calories).toBe(100);
  const entries = (await service.stats("2026-10-02", "2026-10-02")).entries;
  expect(entries.find((e) => e.id === normal.id)?.nutrients.calories).toBe(200);
  expect(entries.find((e) => e.id === manual.id)?.nutrients.calories).toBe(80);
  expect(entries.find((e) => e.id === legacy.id)?.nutrients.calories).toBe(100);
  expect(
    await auditProducts(database, plan, { apply: true, backup }),
  ).toMatchObject({ pending: 0, alreadyApplied: 1 });
  expect(backup).toHaveBeenCalledTimes(1);
  await auditProducts(database, snapshot.reversePlan, {
    apply: true,
    backup: async () => {},
  });
  expect((await service.get<any>("products", item.id)).nutrients.calories).toBe(
    100,
  );
});

it("rolls back earlier changes if a later source cannot recalculate", async () => {
  const first = await change();
  const second = await change();
  const portion = { label: "piece", unit: "piece", grams: 50 };
  second.before = productSchema.parse({
    ...second.before,
    portions: [portion],
  });
  await service.run("save_product", { id: second.id, product: second.before });
  await service.run("log_food", {
    productId: second.id,
    amount: 1,
    unit: "piece",
    date: "2026-10-02",
    idempotencyKey: randomUUID(),
  });
  await expect(
    auditProducts(
      database,
      { username: "auditor", changes: [first, second] },
      { apply: true, backup: async () => {} },
    ),
  ).rejects.toThrow("cannot be recalculated");
  expect(
    (await service.get<any>("products", first.id)).nutrients.calories,
  ).toBe(100);
  expect((await service.get<any>("products", second.id)).portions).toHaveLength(
    1,
  );
});
