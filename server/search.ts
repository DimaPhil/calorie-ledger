import { randomUUID } from "node:crypto";
import {
  productSchema,
  type Product,
  type ProductInput,
  type Nutrients,
  type SearchResult,
} from "../src/shared.js";
import type { Database } from "./db.js";
import { normalize } from "./nutrition.js";
import { limit } from "./auth.js";

const fields =
  "code,product_name,brands,nutriments,serving_size,serving_quantity,serving_quantity_unit,nutrition_data_per";
const offMap: Record<string, [keyof Nutrients, number]> = {
  "energy-kcal": ["calories", 1],
  proteins: ["protein", 1],
  carbohydrates: ["carbs", 1],
  fat: ["fat", 1],
  "saturated-fat": ["saturatedFat", 1],
  "trans-fat": ["transFat", 1],
  sugars: ["sugar", 1],
  "added-sugars": ["addedSugar", 1],
  fiber: ["fiber", 1],
  sodium: ["sodium", 1000],
  cholesterol: ["cholesterol", 1000],
  potassium: ["potassium", 1000],
  calcium: ["calcium", 1000],
  iron: ["iron", 1000],
  "vitamin-c": ["vitaminC", 1000],
  "vitamin-d": ["vitaminD", 1000000],
};
export function fromOFF(raw: any): ProductInput | undefined {
  if (!raw?.product_name) return;
  // OFF's liquid nutrition can be per 100ml. Do not relabel it as 100g without density.
  if (
    raw.nutrition_data_per === "100ml" ||
    /(?:ml|cl|l)\b/i.test(raw.serving_quantity_unit || "") ||
    /\d\s*(?:ml|cl|liters?|litres?)\b/i.test(raw.serving_size || "")
  )
    return;
  const nutrients: Nutrients = {};
  for (const [external, [key, factor]] of Object.entries(offMap)) {
    const value = raw.nutriments?.[`${external}_100g`];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0)
      nutrients[key] = value * factor;
  }
  if (
    nutrients.calories === undefined &&
    typeof raw.nutriments?.energy_100g === "number"
  )
    nutrients.calories = raw.nutriments.energy_100g / 4.184;
  const serving = /(?:^|\()\s*(\d+(?:\.\d+)?)\s*g\b/i.exec(
    raw.serving_size || "",
  );
  const parsed = productSchema.safeParse({
    name: raw.product_name,
    brand: raw.brands || "",
    barcode: raw.code,
    nutrients,
    portions: serving
      ? [
          {
            label: raw.serving_size.slice(0, 80),
            unit: "serving",
            grams: Number(serving[1]),
          },
        ]
      : [],
    source: "openfoodfacts",
    sourceId: raw.code,
    notes: "Open Food Facts (ODbL). Verify against the package label.",
  });
  return parsed.success ? parsed.data : undefined;
}
export async function externalSearch(
  database: Database,
  query: string,
): Promise<{ products: ProductInput[]; warnings: string[] }> {
  const key = "v2:" + normalize(query);
  const { rows } = await database.query(
    "SELECT data FROM search_cache WHERE query=$1 AND expires_at>now()",
    [key],
  );
  if (rows[0]) return rows[0].data;
  const providers = await Promise.allSettled([
    offSearch(database, query),
    usdaSearch(database, query),
  ]);
  const products = providers.flatMap((p) =>
    p.status === "fulfilled" ? p.value : [],
  );
  const failed = providers
    .map((p, i) =>
      p.status === "rejected" ? ["Open Food Facts", "USDA"][i] : "",
    )
    .filter(Boolean);
  const result = {
    products,
    warnings: failed.length
      ? [
          `${failed.join(" and ")} lookup is temporarily unavailable. Saved products still work; retry later or add a custom product from its label.`,
        ]
      : [],
  };
  if (products.length || !failed.length)
    await database.query(
      `INSERT INTO search_cache(query,data,expires_at) VALUES($1,$2,now()+interval '1 day') ON CONFLICT(query) DO UPDATE SET data=$2,expires_at=now()+interval '1 day'`,
      [key, JSON.stringify(result)],
    );
  return result;
}
async function offSearch(
  database: Database,
  query: string,
): Promise<ProductInput[]> {
  await limit(database, "provider:openfoodfacts", 8);
  const barcode = /^\d{8,14}$/.test(query);
  const url = barcode
    ? `https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(query)}?fields=${fields}`
    : `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&tagtype_0=countries&tag_contains_0=contains&tag_0=united-states&page_size=5&fields=${fields}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(6500),
    headers: {
      "User-Agent": "CalorieLedger/1.0 (https://github.com/DimaPhil)",
    },
  });
  if (!response.ok) throw new Error("Provider unavailable");
  const body = await response.json();
  return (barcode ? [body.product] : body.products || [])
    .map(fromOFF)
    .filter(Boolean) as ProductInput[];
}
const usdaNutrients: Record<number, [keyof Nutrients, string]> = {
  1008: ["calories", "KCAL"],
  2047: ["calories", "KCAL"],
  2048: ["calories", "KCAL"],
  1003: ["protein", "G"],
  1004: ["fat", "G"],
  1005: ["carbs", "G"],
  1258: ["saturatedFat", "G"],
  1257: ["transFat", "G"],
  2000: ["sugar", "G"],
  1063: ["sugar", "G"],
  1235: ["addedSugar", "G"],
  1079: ["fiber", "G"],
  1093: ["sodium", "MG"],
  1253: ["cholesterol", "MG"],
  1092: ["potassium", "MG"],
  1087: ["calcium", "MG"],
  1089: ["iron", "MG"],
  1162: ["vitaminC", "MG"],
  1114: ["vitaminD", "UG"],
};
export function fromUSDA(raw: any): ProductInput | undefined {
  if (!raw?.description || !raw.fdcId) return;
  const nutrients: Nutrients = {};
  for (const n of raw.foodNutrients || []) {
    const mapping = usdaNutrients[n.nutrientId];
    if (
      mapping &&
      mapping[1] === String(n.unitName).toUpperCase() &&
      typeof n.value === "number" &&
      n.value >= 0 &&
      Number.isFinite(n.value) &&
      nutrients[mapping[0]] === undefined
    )
      nutrients[mapping[0]] = n.value;
  }
  const portions =
    String(raw.servingSizeUnit).toLowerCase() === "g" && raw.servingSize > 0
      ? [
          {
            label: String(
              raw.householdServingFullText || "label serving",
            ).slice(0, 80),
            unit: "serving",
            grams: raw.servingSize,
          },
        ]
      : [];
  const parsed = productSchema.safeParse({
    name: raw.description,
    brand: raw.brandName || raw.brandOwner || "",
    barcode: raw.gtinUpc,
    nutrients,
    portions,
    source: "usda",
    sourceId: String(raw.fdcId),
    notes:
      "USDA FoodData Central. Values per 100g. Verify branded items against the package label.",
  });
  return parsed.success ? parsed.data : undefined;
}
async function usdaSearch(
  database: Database,
  query: string,
): Promise<ProductInput[]> {
  const key = process.env.USDA_API_KEY || "DEMO_KEY";
  await limit(database, "provider:usda", key === "DEMO_KEY" ? 25 : 900, 3600);
  if (key === "DEMO_KEY")
    await limit(database, "provider:usda:daily", 45, 86400);
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(query)}&pageSize=5`;
  const response = await fetch(url, { signal: AbortSignal.timeout(6500) });
  if (!response.ok) throw new Error("USDA unavailable");
  const body = await response.json();
  return (body.foods || []).map(fromUSDA).filter(Boolean);
}
export type Provider = typeof externalSearch;
export async function search(
  database: Database,
  userId: string,
  query: string,
  external: boolean,
  provider: Provider,
  broaden = false,
): Promise<SearchResult> {
  const normalized = normalize(query);
  if (!normalized)
    return {
      status: "not_found",
      query,
      candidates: [],
      preferredProductId: null,
      matchType: "none",
      requiresProductConfirmation: true,
      reason: "Provide a food name, brand, or barcode.",
      warnings: [],
    };
  const { rows } = await database.query(
    "SELECT id,data,updated_at FROM products WHERE user_id=$1 ORDER BY updated_at DESC",
    [userId],
  );
  const saved: Product[] = rows.map((r) => ({
    ...r.data,
    id: r.id,
    updatedAt: String(r.updated_at),
  }));
  const choice = await database.query(
    "SELECT product_id FROM choices WHERE user_id=$1 AND query=$2",
    [userId, normalized],
  );
  const preferred = saved.find((p) => p.id === choice.rows[0]?.product_id);
  const exact = saved.filter(
    (p) =>
      normalize(p.name) === normalized ||
      normalize(`${p.brand} ${p.name}`) === normalized ||
      p.barcode === query,
  );
  const selected = preferred || (exact.length === 1 ? exact[0] : undefined);
  const requiresProductConfirmation = !selected || broaden;
  const tokens = normalized.split(" ");
  const local = saved
    .map((p) => ({
      p,
      score: tokens.filter((t) => normalize(`${p.brand} ${p.name}`).includes(t))
        .length,
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.p);
  const found = external
    ? await provider(database, query)
    : { products: [], warnings: [] };
  const remote = found.products
    .filter(
      (p) =>
        !saved.some((s) => s.source === p.source && s.sourceId === p.sourceId),
    )
    .map((p) => ({
      ...p,
      id: randomUUID(),
      updatedAt: new Date().toISOString(),
    }));
  const candidates = [
    ...(selected ? [selected] : []),
    ...exact.filter((p) => p !== selected),
    ...local.filter((p) => !exact.includes(p) && p !== selected),
    ...remote,
  ].slice(0, 5);
  return {
    status: !requiresProductConfirmation
      ? "matched"
      : candidates.length
        ? "choose"
        : "not_found",
    query,
    candidates,
    preferredProductId: selected?.id || null,
    matchType: preferred
      ? "confirmed_alias"
      : selected
        ? "exact_saved"
        : "none",
    requiresProductConfirmation,
    reason: !requiresProductConfirmation
      ? "Use preferredProductId without asking which product again. Alternatives are included; amount and portion still need validation."
      : candidates.length
        ? "Choose a product and check the brand and nutrition label. Save external candidates before logging."
        : "No matching food found. Try a brand, barcode, or add a custom product.",
    warnings: found.warnings,
  };
}
