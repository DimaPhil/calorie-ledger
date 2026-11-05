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

it("retires check-ins without deleting historical records or food targets", async () => {
  const legacy = { date: "2029-01-01", complete: true, sleep: 7, weight: 95 };
  await db.query("INSERT INTO checkins(user_id,date,data) VALUES($1,$2,$3)", [
    a.user.id,
    legacy.date,
    JSON.stringify(legacy),
  ]);
  const goals = {
    effectiveDate: legacy.date,
    targets: { ...defaultGoals, calories: 2300, beverages: 2000, sleep: 8 },
  };
  await db.query(
    "INSERT INTO goals(user_id,effective_date,data) VALUES($1,$2,$3)",
    [a.user.id, legacy.date, JSON.stringify(goals)],
  );
  const result = await a.run("get_goals", {
    start: legacy.date,
    end: legacy.date,
  });
  expect(result).not.toHaveProperty("checkins");
  expect(result.settings.targets.calories).toBe(2300);
  expect(result.settings.targets).not.toHaveProperty("beverages");
  expect(result.settings.targets).not.toHaveProperty("sleep");
  expect(
    (await b.run("get_goals", { start: legacy.date, end: legacy.date }))
      .settings.targets.calories,
  ).toBe(2100);
  expect(
    (
      await db.query("SELECT data FROM checkins WHERE user_id=$1 AND date=$2", [
        a.user.id,
        legacy.date,
      ])
    ).rows[0].data,
  ).toEqual(legacy);
});

it("previews saved and unsaved foods and dishes without writing, with honest goal impact", async () => {
  const date = "2028-01-01";
  const food = await a.run("save_product", {
    product: {
      name: "Preview oats",
      nutrients: { calories: 400, protein: 10 },
      portions: [{ label: "cup", unit: "cup", grams: 80 }],
    },
  });
  const dish = await a.run("save_dish", {
    dish: {
      name: "Preview bowl",
      ingredients: [{ productId: food.id, amount: 100, unit: "g" }],
      servings: 2,
    },
  });
  await a.run("log_food", {
    date,
    productId: food.id,
    amount: 50,
    unit: "g",
    idempotencyKey: randomUUID(),
  });
  const before = await db.query(
    "SELECT (SELECT count(*) FROM entries) entries,(SELECT count(*) FROM products) products,(SELECT count(*) FROM dishes) dishes,(SELECT count(*) FROM choices) choices,(SELECT count(*) FROM checkins) checkins",
  );
  const result = await a.run("preview_food", {
    productId: food.id,
    amount: 0.5,
    unit: "cup",
    date,
  });
  expect(result).toMatchObject({
    logged: false,
    nutrients: { calories: 160, protein: 4 },
  });
  expect(
    result.goalImpact.find((v: any) => v.key === "calories"),
  ).toMatchObject({
    currentLogged: 200,
    portion: 160,
    projected: 360,
    remaining: 1740,
    complete: true,
  });
  expect(result.goalImpact.find((v: any) => v.key === "fiber")).toMatchObject({
    projected: null,
    complete: false,
  });
  expect(
    (
      await a.run("preview_food", {
        dishId: dish.id,
        amount: 1,
        unit: "serving",
        date,
      })
    ).nutrients.calories,
  ).toBe(200);
  expect(
    (
      await a.run("preview_food", {
        product: { name: "Unsaved", nutrients: { fat: 5 } },
        amount: 200,
        unit: "g",
        date,
      })
    ).nutrients,
  ).toEqual({ fat: 10 });
  expect(
    (
      await a.run("preview_food", {
        product: { name: "Possible food", nutrients: { calories: 100 } },
        amount: 100,
        unit: "g",
        date: "2028-01-02",
      })
    ).goalImpact[0].currentLogged,
  ).toBe(0);
  await expect(
    b.run("preview_food", { productId: food.id, amount: 100, unit: "g", date }),
  ).rejects.toThrow();
  await expect(
    a.run("preview_food", {
      productId: food.id,
      amount: 1,
      unit: "piece",
      date,
    }),
  ).rejects.toThrow();
  const after = await db.query(
    "SELECT (SELECT count(*) FROM entries) entries,(SELECT count(*) FROM products) products,(SELECT count(*) FROM dishes) dishes,(SELECT count(*) FROM choices) choices,(SELECT count(*) FROM checkins) checkins",
  );
  expect(after.rows).toEqual(before.rows);
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

it("stores effective-date goals with owner isolation and validation", async () => {
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
  await expect(
    a.run("save_goals", { effectiveDate: "2026-02-30", targets: defaultGoals }),
  ).rejects.toThrow();
  await expect(
    a.run("save_goals", {
      effectiveDate: "2026-09-24",
      targets: { ...defaultGoals, protein: -1 },
    }),
  ).rejects.toThrow();
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
