import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { testDatabase } from "../server/db.js";
import { createUser } from "../server/auth.js";
import { Service } from "../server/service.js";
import {
  productSchema,
  type Product,
  type Dish,
  type User,
} from "../src/shared.js";
import { externalSearch } from "../server/search.js";
let database: Awaited<ReturnType<typeof testDatabase>>;
let a: Service, b: Service, p: Product;
const provider = vi.fn(async () => ({
  products: [
    productSchema.parse({
      name: "External oats",
      brand: "Fresh",
      nutrients: { calories: 300 },
      source: "openfoodfacts",
      sourceId: "12345678",
    }),
  ],
  warnings: [],
}));
beforeAll(async () => {
  database = await testDatabase();
  const id = await createUser(database, "alice", "long-password-12345");
  const id2 = await createUser(database, "bob", "long-password-12345");
  a = new Service(
    database,
    {
      id,
      username: "alice",
      timezone: "America/Los_Angeles",
      unitSystem: "metric",
    },
    provider,
  );
  b = new Service(
    database,
    { id: id2, username: "bob", timezone: "UTC", unitSystem: "metric" },
    provider,
  );
  p = await a.run("save_product", {
    product: {
      name: "Rolled oats",
      brand: "Daily",
      nutrients: { calories: 400, protein: 10, carbs: 60, fat: 8, sugar: 2 },
      portions: [{ label: "cup", unit: "cup", grams: 80 }],
    },
  });
});
afterAll(async () => {
  vi.restoreAllMocks();
  await database.close();
});
const input = (extra: object = {}) => ({
  productId: p.id,
  amount: 100,
  unit: "g",
  date: "2026-09-22",
  meal: "breakfast",
  idempotencyKey: randomUUID(),
  ...extra,
});
describe("food diary service", () => {
  it("isolates every owner read/write and choice", async () => {
    expect(await b.run("list_products", {})).toEqual([]);
    await expect(
      b.run("save_product", { id: p.id, product: pInput("Other") }),
    ).rejects.toThrow("not found");
    await expect(b.run("delete_product", { id: p.id })).rejects.toThrow(
      "not found",
    );
    await expect(
      b.run("remember_choice", { query: "oats", productId: p.id }),
    ).rejects.toThrow("another account");
    await expect(b.run("log_food", input())).rejects.toThrow("another account");
  });
  it("asks for missing/invalid fields and rejects impossible dates", async () => {
    await expect(a.run("log_food", {})).rejects.toMatchObject({
      code: "clarification_required",
    });
    await expect(
      a.run("log_food", input({ date: "2026-02-30" })),
    ).rejects.toMatchObject({ code: "invalid_date" });
    await expect(a.run("log_food", input({ amount: 0 }))).rejects.toMatchObject(
      { code: "clarification_required" },
    );
    await expect(
      a.run("log_food", input({ dishId: randomUUID() })),
    ).rejects.toMatchObject({ code: "clarification_required" });
    await expect(
      a.run(
        "log_food",
        input({ ingredients: [{ productId: p.id, amount: 1, unit: "g" }] }),
      ),
    ).rejects.toThrow("overrides");
  });
  it("makes concurrent retry-safe logs and detects changed payloads", async () => {
    const request = input();
    const results = await Promise.all([
      a.run("log_food", request),
      a.run("log_food", request),
    ]);
    expect(results[0].entry.id).toBe(results[1].entry.id);
    expect(results.filter((r) => r.replayed)).toHaveLength(1);
    await expect(
      a.run("log_food", { ...request, amount: 101 }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
  });
  it("snapshots nutrition and reports missing data without zero invention", async () => {
    const saved = await a.run("save_product", { product: pInput("Snapshot") });
    const logged = await a.run(
      "log_food",
      input({ productId: saved.id, amount: 50, date: "2026-08-01" }),
    );
    expect(logged.entry.nutrients.calories).toBe(200);
    await a.run("save_product", {
      id: saved.id,
      product: { ...pInput("Changed"), nutrients: { calories: 900 } },
    });
    const stats = await a.run("get_stats", {
      start: "2026-08-01",
      end: "2026-08-02",
    });
    expect(stats.totals.calories).toBe(200);
    expect(stats.missingNutrients).toContain("fiber");
    expect(stats.totals.fiber).toBeUndefined();
    expect(stats.days[1].count).toBe(0);
    expect(
      (await b.run("get_stats", { start: "2026-08-01", end: "2026-08-02" }))
        .entries,
    ).toEqual([]);
    await expect(
      b.run("update_entry", {
        id: logged.entry.id,
        date: "2026-08-03",
        meal: "lunch",
        notes: "",
      }),
    ).rejects.toThrow();
    const updated = await a.run("update_entry", {
      id: logged.entry.id,
      date: "2026-08-03",
      meal: "lunch",
      notes: "corrected",
    });
    expect(updated.nutrients.calories).toBe(200);
    await expect(
      b.run("delete_entry", { id: logged.entry.id }),
    ).rejects.toThrow();
    await a.run("delete_entry", { id: logged.entry.id });
    expect(
      (await a.run("get_stats", { start: "2026-08-01", end: "2026-08-03" }))
        .entries,
    ).toEqual([]);
  });
  it("requires missing calories or portion weight", async () => {
    const incomplete = await a.run("save_product", {
      product: { name: "Unknown", nutrients: { protein: 10 } },
    });
    await expect(
      a.run("log_food", input({ productId: incomplete.id })),
    ).rejects.toMatchObject({ code: "clarification_required" });
    expect(
      await a.run("resolve_food", { query: "Unknown", amount: 100, unit: "g" }),
    ).toMatchObject({
      status: "clarification_required",
      missing: ["calories per 100g"],
    });
    await expect(
      a.run("log_food", input({ unit: "piece", amount: 1 })),
    ).rejects.toMatchObject({ code: "clarification_required" });
  });
  it("does not resurrect deleted entries when an old request is retried", async () => {
    const request = input({ date: "2026-07-01" });
    const saved = await a.run("log_food", request);
    await a.run("delete_entry", { id: saved.entry.id });
    await expect(a.run("log_food", request)).rejects.toMatchObject({
      code: "entry_deleted",
    });
    await expect(
      a.run("update_entry", {
        id: saved.entry.id,
        date: "2026-07-01",
        meal: "lunch",
        notes: "",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(
      (await a.run("get_stats", { start: "2026-07-01", end: "2026-07-01" }))
        .entries,
    ).toEqual([]);
  });
  it("rolls back logging when a dependent preference mutation fails", async () => {
    await expect(
      a.run("log_food", input({ query: "!!!", date: "2026-07-02" })),
    ).rejects.toMatchObject({ code: "invalid_query" });
    expect(
      (await a.run("get_stats", { start: "2026-07-02", end: "2026-07-02" }))
        .entries,
    ).toEqual([]);
  });
  it("serializes a product deletion against creating a recipe that uses it", async () => {
    const product = await a.run("save_product", {
      product: pInput("Concurrent product"),
    });
    const outcomes = await Promise.allSettled([
      a.run("save_dish", {
        dish: {
          name: "Concurrent dish",
          ingredients: [{ productId: product.id, amount: 100, unit: "g" }],
          servings: 1,
        },
      }),
      a.run("delete_product", { id: product.id }),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const dishes = await a.run("list_dishes", {});
    if (dishes.some((d: Dish) => d.name === "Concurrent dish"))
      expect(await a.get("products", product.id)).toBeDefined();
  });
  it("supports recipes, yield, meal-specific overrides and cooked weights", async () => {
    const dish = (await a.run("save_dish", {
      dish: {
        name: "Oat bowl",
        ingredients: [{ productId: p.id, amount: 100, unit: "g" }],
        servings: 2,
        cookedWeight: 300,
      },
    })) as Dish;
    const preview = await a.run("preview_dish", {
      dish: (({ id, updatedAt, ...rest }) => rest)(dish),
    });
    expect(preview.perServing.calories).toBe(200);
    const log = (extra: object) =>
      a.run("log_food", {
        dishId: dish.id,
        amount: 1,
        unit: "serving",
        date: "2026-09-21",
        idempotencyKey: randomUUID(),
        ...extra,
      });
    expect((await log({})).entry.nutrients.calories).toBe(200);
    expect(
      (await log({ unit: "g", amount: 150 })).entry.nutrients.calories,
    ).toBe(200);
    expect(
      (
        await log({
          ingredients: [{ productId: p.id, amount: 200, unit: "g" }],
        })
      ).entry.nutrients.calories,
    ).toBe(400);
    expect((await a.run("list_dishes", {}))[0].ingredients[0].amount).toBe(100);
    await expect(log({ unit: "piece" })).rejects.toMatchObject({
      code: "clarification_required",
    });
    await expect(
      log({
        unit: "g",
        amount: 100,
        ingredients: [{ productId: p.id, amount: 200, unit: "g" }],
      }),
    ).rejects.toThrow("servings");
    await expect(b.run("delete_dish", { id: dish.id })).rejects.toThrow();
    await expect(a.run("delete_product", { id: p.id })).rejects.toMatchObject({
      code: "in_use",
    });
    await a.run("delete_dish", { id: dish.id });
  });
  it("supports local timezone and US preferences", async () => {
    await expect(
      a.run("update_profile", { timezone: "Wrong/Zone", unitSystem: "us" }),
    ).rejects.toThrow("timezone");
    expect(
      await a.run("update_profile", {
        timezone: "Pacific/Kiritimati",
        unitSystem: "us",
      }),
    ).toMatchObject({ timezone: "Pacific/Kiritimati", unitSystem: "us" });
    expect(await a.run("get_profile", {})).toHaveProperty("today");
  });
});
describe("agent food resolution", () => {
  it("broadens exact and remembered matches without forgetting the choice", async () => {
    await a.run("remember_choice", {
      query: "morning staple",
      productId: p.id,
    });
    for (const query of ["Rolled oats", "morning staple"]) {
      provider.mockClear();
      expect((await a.run("search_products", { query })).status).toBe(
        "matched",
      );
      expect(provider).toHaveBeenCalledWith(database, query);
      provider.mockClear();
      const resolved = await a.run("resolve_food", {
        query,
        amount: 10,
        unit: "g",
      });
      expect(resolved).toMatchObject({
        status: "ready",
        preferredProductId: p.id,
        requiresProductConfirmation: false,
      });
      expect(provider).not.toHaveBeenCalled();
      const result = await a.run("search_products", { query, broaden: true });
      expect(provider).toHaveBeenCalledWith(database, query);
      expect(result.status).toBe("choose");
      expect(result).toMatchObject({
        preferredProductId: p.id,
        requiresProductConfirmation: true,
      });
      expect(result.candidates[0].id).toBe(p.id);
      expect(
        result.candidates.some((x: Product) => x.name === "External oats"),
      ).toBe(true);
      expect((await a.run("search_products", { query })).status).toBe(
        "matched",
      );
    }
  });
  it("matches exact local names; asks for amount; computes ready response", async () => {
    expect(
      (await a.run("search_products", { query: "Rolled oats" })).status,
    ).toBe("matched");
    expect(
      (await a.run("resolve_food", { query: "Rolled oats" })).missing,
    ).toEqual(["amount", "unit"]);
    const result = await a.run("resolve_food", {
      query: "Rolled oats",
      amount: 1,
      unit: "cup",
    });
    expect(result.status).toBe("ready");
    expect(result.nutrients.calories).toBe(320);
  });
  it("returns alternatives while making confirmed identity explicit", async () => {
    const alternative = await a.run("save_product", {
      product: pInput("Sweet small rolled oats"),
    });
    const result = await a.run("search_products", { query: "Rolled oats" });
    expect(result).toMatchObject({
      status: "matched",
      preferredProductId: p.id,
      matchType: "exact_saved",
      requiresProductConfirmation: false,
    });
    expect(result.candidates.map((x: Product) => x.id)).toContain(
      alternative.id,
    );
    expect(
      result.candidates.some((x: Product) => x.name === "External oats"),
    ).toBe(true);
    await a.run("remember_choice", { query: "my oats", productId: p.id });
    expect(await a.run("resolve_food", { query: "my oats" })).toMatchObject({
      status: "clarification_required",
      preferredProductId: p.id,
      matchType: "confirmed_alias",
      requiresProductConfirmation: false,
      missing: ["amount", "unit"],
    });
    expect(
      await a.run("search_products", { query: "sweet small my oats" }),
    ).toMatchObject({
      status: "choose",
      preferredProductId: null,
      matchType: "none",
      requiresProductConfirmation: true,
    });
    expect(
      await b.run("search_products", { query: "my oats", external: false }),
    ).toMatchObject({
      preferredProductId: null,
      matchType: "none",
      requiresProductConfirmation: true,
    });
  });
  it("puts a confirmed alias ahead of conflicting exact saved names", async () => {
    await a.run("save_product", { product: pInput("Rolled oats") });
    await a.run("remember_choice", { query: "Rolled oats", productId: p.id });
    const result = await a.run("search_products", { query: "Rolled oats" });
    expect(result).toMatchObject({
      preferredProductId: p.id,
      matchType: "confirmed_alias",
      requiresProductConfirmation: false,
    });
    expect(result.candidates[0].id).toBe(p.id);
    expect(
      result.candidates.filter((x: Product) => x.id === p.id),
    ).toHaveLength(1);
    await expect(
      a.run("resolve_food", {
        query: "Rolled oats",
        amount: 1,
        unit: "piece",
        portionLabel: "small",
      }),
    ).rejects.toMatchObject({ code: "clarification_required" });
  });
  it("returns at most five choices and remembers only confirmed aliases", async () => {
    for (let i = 0; i < 6; i++)
      await a.run("save_product", { product: pInput(`Cereal ${i}`) });
    const result = await a.run("search_products", { query: "cereal" });
    expect(result.status).toBe("choose");
    expect(result.candidates).toHaveLength(5);
    await a.run("remember_choice", { query: "my breakfast", productId: p.id });
    expect(
      (
        await a.run("resolve_food", {
          query: "my breakfast",
          amount: 10,
          unit: "g",
        })
      ).candidates[0].id,
    ).toBe(p.id);
    expect(
      (
        await b.run("search_products", {
          query: "my breakfast",
          external: false,
        })
      ).status,
    ).toBe("not_found");
    await expect(
      a.run("remember_choice", { query: "!!!", productId: p.id }),
    ).rejects.toThrow();
  });
  it("does not auto-pick duplicate names or external candidates", async () => {
    await a.run("save_product", { product: pInput("Duplicate") });
    await a.run("save_product", { product: pInput("Duplicate") });
    expect(
      (await a.run("search_products", { query: "Duplicate" })).status,
    ).toBe("choose");
    const result = await a.run("resolve_food", { query: "unusual food" });
    expect(result.status).toBe("choose");
    expect(result.next).toContain("Save external");
    await expect(
      a.run("log_food", input({ productId: result.candidates[0].id })),
    ).rejects.toThrow();
  });
  it("handles provider failure, caches results, and respects rate limits", async () => {
    const mock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("timeout"));
    const failed = await externalSearch(database, "timeout-query");
    expect(failed.warnings).toHaveLength(1);
    mock.mockResolvedValue(
      new Response(
        JSON.stringify({
          products: [
            {
              product_name: "API food",
              code: "9988",
              nutriments: { "energy-kcal_100g": 12 },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const found = await externalSearch(database, "api-query");
    expect(found.products[0].name).toBe("API food");
    const calls = mock.mock.calls.length;
    expect(await externalSearch(database, "api-query")).toEqual(found);
    expect(mock.mock.calls.length).toBe(calls);
    mock.mockResolvedValue(new Response("", { status: 429 }));
    expect(
      (await externalSearch(database, "rate-query")).warnings,
    ).toHaveLength(1);
    mock.mockRestore();
  });
});
function pInput(name: string) {
  return {
    name,
    brand: "Test",
    nutrients: { calories: 400, protein: 10 },
    portions: [],
    notes: "",
  };
}
