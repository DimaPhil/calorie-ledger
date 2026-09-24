import { afterEach, describe, expect, it, vi } from "vitest";
import { enrichProduct } from "../server/enrichment.js";
import { type Product } from "../src/shared.js";

const food: Product = {
  id: "00000000-0000-4000-8000-000000000001",
  updatedAt: "2026-09-24",
  name: "My avocado",
  brand: "Saved brand",
  source: "usda",
  sourceId: "123456",
  nutrients: { calories: 160, sodium: 0 },
  portions: [{ label: "My half", unit: "piece", grams: 80 }],
  notes: "My correction",
};
const detail = {
  fdcId: 123456,
  description: "Provider avocado",
  foodNutrients: [
    { nutrient: { id: 1008, unitName: "kcal" }, amount: 170 },
    { nutrient: { id: 1090, unitName: "mg" }, amount: 29 },
    { nutrient: { id: 1093, unitName: "mg" }, amount: 7 },
    { nutrient: { id: 2000, unitName: "g" }, amount: 0 },
  ],
};
const mockResponse = (body: unknown) =>
  vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(body)));
afterEach(() => vi.restoreAllMocks());

describe("saved-food enrichment", () => {
  it("fills missing values from exact USDA detail while preserving corrections, metadata, and unknown free sugars", async () => {
    const fetch = mockResponse(detail);
    const result = await enrichProduct(food);
    expect(result.added).toEqual(["sugar", "magnesium"]);
    expect(result.product.nutrients).toEqual({
      calories: 160,
      sodium: 0,
      magnesium: 29,
      sugar: 0,
    });
    expect(result.product.name).toBe(food.name);
    expect(result.product.portions).toEqual(food.portions);
    expect(result.product.notes).toContain(
      "My correction\nEnriched missing sugar, magnesium from usda 123456",
    );
    expect(fetch.mock.calls[0][0]).toMatch(
      /^https:\/\/api.nal.usda.gov\/fdc\/v1\/food\/123456\?/,
    );
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "error" });
    expect(food.nutrients).toEqual({ calories: 160, sodium: 0 });
    fetch.mockResolvedValue(new Response(JSON.stringify(detail)));
    const repeated = await enrichProduct({ ...food, ...result.product });
    expect(repeated.added).toEqual([]);
    expect(repeated.product.notes).toBe(result.product.notes);
  });

  it("uses OFF exact barcode and its gram-based conversion, rejecting liquid basis", async () => {
    const raw = {
      code: "1234567890123",
      product_name: "Label food",
      nutriments: {
        magnesium_100g: 0.05,
        sugars_100g: 5,
        "added-sugars_100g": 3,
      },
    };
    const fetch = mockResponse({ product: raw });
    const off = {
      ...food,
      source: "openfoodfacts" as const,
      sourceId: raw.code,
    };
    const result = await enrichProduct(off);
    expect(result.product.nutrients.magnesium).toBe(50);
    expect(result.product.nutrients.freeSugar).toBeUndefined();
    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ product: { ...raw, nutrition_data_per: "100ml" } }),
      ),
    );
    expect((await enrichProduct(off)).added).toEqual([]);
  });

  it("does not guess source IDs, cross food identities, or discard notes", async () => {
    const fetch = mockResponse({ ...detail, fdcId: 99999 });
    expect(
      (await enrichProduct({ ...food, sourceId: "https://example.com" })).added,
    ).toEqual([]);
    expect((await enrichProduct({ ...food, source: "custom" })).added).toEqual(
      [],
    );
    expect(fetch).not.toHaveBeenCalled();
    expect((await enrichProduct(food)).warning).toContain("different food ID");
    fetch.mockResolvedValue(new Response(JSON.stringify(detail)));
    const fullNotes = { ...food, notes: "x".repeat(2000) };
    const result = await enrichProduct(fullNotes);
    expect(result.added).toEqual([]);
    expect(result.product.notes).toBe(fullNotes.notes);
  });

  it("sanitizes provider failures and rejects invalid units or values", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("api_key=secret"));
    expect(JSON.stringify(await enrichProduct(food))).not.toContain("secret");
    fetch.mockResolvedValue(new Response("rate limited", { status: 429 }));
    expect((await enrichProduct(food)).warning).toContain(
      "Provider unavailable",
    );
    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          ...detail,
          foodNutrients: [
            { nutrient: { id: 1090, unitName: "g" }, amount: 29 },
            { nutrient: { id: 1087, unitName: "mg" }, amount: -1 },
          ],
        }),
      ),
    );
    expect((await enrichProduct(food)).added).toEqual([]);
  });
});
