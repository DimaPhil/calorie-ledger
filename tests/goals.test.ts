import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { testDatabase } from "../server/db.js";
import { createUser } from "../server/auth.js";
import { Service } from "../server/service.js";
import { defaultGoals } from "../src/goals-shared.js";
import type { Product, Entry } from "../src/shared.js";

let db: Awaited<ReturnType<typeof testDatabase>>, a: Service, b: Service;
beforeAll(async () => {
  db = await testDatabase();
  const make = async (username: string) =>
    new Service(db, {
      id: await createUser(db, username, "test-password-long"),
      username,
      timezone: "UTC",
      unitSystem: "metric",
    });
  a = await make("goals-a");
  b = await make("goals-b");
});
afterAll(async () => {
  await db.close();
});

it("enriches only the owner's food, preserving stored journal snapshots", async () => {
  const food: Product = await a.run("save_product", {
    product: {
      name: "Source food",
      source: "usda",
      sourceId: "123",
      nutrients: { calories: 100 },
    },
  });
  const logged = await a.run("log_food", {
    productId: food.id,
    date: "2026-09-24",
    amount: 100,
    unit: "g",
    idempotencyKey: randomUUID(),
  });
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        fdcId: 123,
        description: "Source food",
        foodNutrients: [{ nutrient: { id: 1090, unitName: "MG" }, amount: 40 }],
      }),
    ),
  );
  try {
    await expect(
      b.run("save_enriched_product", { id: food.id }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      (await a.run("save_enriched_product", { id: food.id })).added,
    ).toEqual(["magnesium"]);
    const foods: Product[] = await a.run("list_products", {});
    expect(foods.find((p) => p.id === food.id)?.nutrients.magnesium).toBe(40);
    const entries: Entry[] = (
      await a.run("get_stats", { start: "2026-09-24", end: "2026-09-24" })
    ).entries;
    expect(entries.find((e) => e.id === logged.entry.id)).toEqual(logged.entry);
  } finally {
    fetchMock.mockRestore();
  }
});

it("stores effective-date goals and check-ins with owner isolation and validation", async () => {
  const dates = { start: "2026-09-01", end: "2026-09-30" };
  expect((await a.run("get_goals", dates)).settings.targets.calories).toBe(
    2100,
  );
  await a.run("save_goals", {
    effectiveDate: "2026-09-24",
    targets: { ...defaultGoals, calories: 2200 },
  });
  expect(
    (await a.run("get_goals", { ...dates, end: "2026-09-23" })).settings.targets
      .calories,
  ).toBe(2100);
  expect((await a.run("get_goals", dates)).settings.targets.calories).toBe(
    2200,
  );
  expect((await b.run("get_goals", dates)).settings.targets.calories).toBe(
    2100,
  );
  await a.run("save_checkin", {
    date: "2026-09-24",
    complete: true,
    weight: 95,
    beverages: 2000,
    energy: 4,
  });
  const result = await a.run("get_goals", dates);
  expect(result.checkins).toEqual([
    {
      date: "2026-09-24",
      complete: true,
      weight: 95,
      beverages: 2000,
      energy: 4,
    },
  ]);
  expect((await b.run("get_goals", dates)).checkins).toEqual([]);
  await expect(
    a.run("save_checkin", { date: "2026-02-30", complete: false }),
  ).rejects.toThrow();
  await expect(
    a.run("save_checkin", { date: "2026-09-24", complete: false, sleep: 25 }),
  ).rejects.toThrow();
  await expect(
    a.run("save_goals", {
      effectiveDate: "2026-09-24",
      targets: { ...defaultGoals, protein: -1 },
    }),
  ).rejects.toThrow();
  await a.run("save_checkin", { date: "2026-09-24", complete: false });
  expect((await a.run("get_goals", dates)).checkins).toEqual([
    { date: "2026-09-24", complete: false },
  ]);
});

it("tracks new nutrients only on new entries and preserves manual overrides on source edits", async () => {
  const product: Product = await a.run("save_product", {
    product: { name: "Nutrition test", nutrients: { calories: 100 } },
  });
  const log = async (): Promise<Entry> =>
    (
      await a.run("log_food", {
        productId: product.id,
        date: "2026-09-24",
        amount: 100,
        unit: "g",
        idempotencyKey: randomUUID(),
      })
    ).entry;
  const old = await log();
  await db.query(
    "UPDATE entries SET data=data - 'trackedNutrients' WHERE user_id=$1 AND id=$2",
    [a.user.id, old.id],
  );
  const current = await log();
  const manual = await log();
  await a.run("update_entry", {
    id: manual.id,
    date: manual.date,
    meal: manual.meal,
    notes: "",
    expectedRevision: 0,
    items: [
      {
        name: product.name,
        grams: 100,
        nutrients: { calories: 120, magnesium: 5 },
      },
    ],
  });
  const { id, updatedAt: _, ...data } = product;
  await a.run("save_product", {
    id,
    product: {
      ...data,
      nutrients: { calories: 110, magnesium: 40, freeSugar: 2 },
    },
  });
  const entries: Entry[] = (
    await a.run("get_stats", { start: "2026-09-24", end: "2026-09-24" })
  ).entries;
  expect(entries.find((e) => e.id === old.id)?.nutrients).toEqual({
    calories: 110,
  });
  expect(entries.find((e) => e.id === current.id)?.nutrients).toEqual({
    calories: 110,
    magnesium: 40,
    freeSugar: 2,
  });
  expect(entries.find((e) => e.id === manual.id)?.nutrients).toEqual({
    calories: 120,
    magnesium: 5,
  });
});
