import { describe, it, expect } from "vitest";
import { grams, normalize, range, scale, sum } from "../server/nutrition.js";
import { fromOFF, fromUSDA } from "../server/search.js";
import { productSchema, type Product } from "../src/shared.js";
const product = {
  id: "test",
  updatedAt: "",
  ...productSchema.parse({
    name: "Oats",
    nutrients: { calories: 400 },
    portions: [
      { label: "cup", unit: "cup", grams: 80 },
      { label: "bar", unit: "piece", grams: 40 },
    ],
  }),
} as Product;
describe("nutrition and units", () => {
  it.each([
    ["g", 100, 100],
    ["kg", 1, 1000],
    ["oz", 1, 28.349523125],
    ["lb", 1, 453.59237],
    ["cup", 1, 80],
    ["tbsp", 16, 80],
    ["tsp", 48, 80],
    ["fl_oz", 8, 80],
    ["ml", 236.5882365, 80],
    ["l", 0.2365882365, 80],
    ["piece", 2, 80],
  ] as const)(
    "converts %s with product-specific density",
    (unit, amount, expected) =>
      expect(grams(product, { unit, amount })).toBeCloseTo(expected),
  );
  it("asks for unknown or ambiguous portions", () => {
    expect(() => grams(product, { amount: 1, unit: "serving" })).toThrow(
      "How much",
    );
    const p = {
      ...product,
      portions: [
        ...product.portions,
        { label: "large bar", unit: "piece" as const, grams: 60 },
      ],
    };
    expect(() => grams(p, { amount: 1, unit: "piece" })).toThrow();
    expect(
      grams(p, { amount: 1, unit: "piece", portionLabel: "large bar" }),
    ).toBe(60);
    expect(() =>
      grams({ ...product, portions: [] }, { amount: 1, unit: "cup" }),
    ).toThrow();
  });
  it("preserves unknown nutrients and exact calculations", () => {
    expect(scale({ calories: 333, protein: 3 }, 0.3)).toEqual({
      calories: 99.89999999999999,
      protein: 0.8999999999999999,
    });
    expect(sum([{ protein: 2 }, { protein: 3, calories: 100 }])).toEqual({
      protein: 5,
      calories: 100,
    });
    expect(sum([])).toEqual({});
  });
  it("validates actual calendar dates, leap years, ordering and range limits", () => {
    expect(range("2024-02-28", "2024-03-01")).toHaveLength(3);
    expect(() => range("2025-02-29", "2025-03-01")).toThrow();
    expect(() => range("2025-03-02", "2025-03-01")).toThrow();
    expect(() => range("2024-01-01", "2025-01-02")).toThrow();
    expect(normalize("  Éggs — ORGANIC! ")).toBe("éggs organic");
  });
  it("validates numeric data at boundaries", () => {
    expect(
      productSchema.safeParse({ name: "x", nutrients: { calories: -1 } })
        .success,
    ).toBe(false);
    expect(
      productSchema.safeParse({ name: "x", nutrients: { calories: Infinity } })
        .success,
    ).toBe(false);
    expect(
      productSchema.safeParse({ name: "x", nutrients: { mystery: 3 } }).success,
    ).toBe(false);
  });
});
describe("Open Food Facts normalization", () => {
  it("normalizes USDA units, optional serving weights and unknown values", () => {
    expect(
      fromUSDA({
        fdcId: 123,
        description: "Oats",
        servingSize: 40,
        servingSizeUnit: "g",
        foodNutrients: [
          { nutrientId: 1008, value: 400, unitName: "KCAL" },
          { nutrientId: 1093, value: 12, unitName: "MG" },
          { nutrientId: 1003, value: 4, unitName: "KG" },
        ],
      }),
    ).toMatchObject({
      name: "Oats",
      source: "usda",
      sourceId: "123",
      nutrients: { calories: 400, sodium: 12 },
      portions: [{ unit: "serving", grams: 40 }],
    });
    expect(fromUSDA({ description: "Missing ID" })).toBeUndefined();
    expect(
      fromUSDA({
        fdcId: 12,
        description: "Liquid",
        servingSize: 240,
        servingSizeUnit: "ml",
        foodNutrients: [],
      })?.portions,
    ).toEqual([]);
  });
  it("converts grams of sodium to mg; extracts servings; leaves unknowns out", () => {
    const p = fromOFF({
      code: "123",
      product_name: "Oats",
      brands: "Brand",
      serving_size: "1 cup (40 g)",
      nutriments: {
        "energy-kcal_100g": 400,
        proteins_100g: 10,
        sodium_100g: 0.2,
        "vitamin-d_100g": 0.000001,
      },
    })!;
    expect(p.nutrients).toEqual({
      calories: 400,
      protein: 10,
      sodium: 200,
      vitaminD: 1,
    });
    expect(p.portions).toEqual([
      { label: "1 cup (40 g)", unit: "serving", grams: 40 },
    ]);
  });
  it("handles kJ, invalid records, and rejects ambiguous liquid basis", () => {
    expect(
      fromOFF({ product_name: "x", nutriments: { energy_100g: 418.4 } })
        ?.nutrients.calories,
    ).toBeCloseTo(100);
    expect(fromOFF(undefined)).toBeUndefined();
    expect(
      fromOFF({ product_name: "Milk", nutrition_data_per: "100ml" }),
    ).toBeUndefined();
    expect(
      fromOFF({
        product_name: "Milk",
        serving_size: "1 cup (240 ml)",
        nutriments: { "energy-kcal_100g": 60 },
      }),
    ).toBeUndefined();
    expect(
      fromOFF({ product_name: "x", nutriments: { proteins_100g: -4 } })
        ?.nutrients,
    ).toEqual({});
  });
});
