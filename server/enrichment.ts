import {
  nutrientKeys,
  productSchema,
  type Product,
  type ProductInput,
} from "../src/shared.js";
import { fromOFF, fromUSDA } from "./search.js";

/** Exact-source, missing-only enrichment. The caller decides how to persist it. */
export async function enrichProduct(saved: Product): Promise<{
  product: ProductInput;
  added: string[];
  warning?: string;
}> {
  const { id: _id, updatedAt: _updatedAt, ...data } = saved;
  const product = productSchema.parse(data);
  const unchanged = (warning: string) => ({ product, added: [], warning });
  const sourceId = product.sourceId || "";
  if (product.source === "custom")
    return unchanged(
      "Custom food: add missing values from a verified label or reference.",
    );
  if (!(product.source === "usda" ? /^\d{1,10}$/ : /^\d{8,14}$/).test(sourceId))
    return unchanged(
      "No valid exact provider ID; automatic enrichment skipped.",
    );
  try {
    const url =
      product.source === "usda"
        ? `https://api.nal.usda.gov/fdc/v1/food/${sourceId}?api_key=${encodeURIComponent(process.env.USDA_API_KEY || "DEMO_KEY")}`
        : `https://world.openfoodfacts.org/api/v3/product/${sourceId}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(6500),
      redirect: "error",
      headers: {
        "User-Agent": "CalorieLedger/1.0 (https://github.com/DimaPhil)",
      },
    });
    if (!response.ok)
      return unchanged("Provider unavailable; retry enrichment later.");
    const body = await response.json();
    let source: ProductInput | undefined;
    if (product.source === "usda") {
      if (String(body.fdcId) !== sourceId)
        return unchanged("Provider returned a different food ID; skipped.");
      source = fromUSDA({
        ...body,
        foodNutrients: (body.foodNutrients || []).map((item: any) => ({
          nutrientId: item.nutrient?.id,
          unitName: item.nutrient?.unitName,
          value: item.amount,
        })),
      });
    } else {
      if (String(body.product?.code) !== sourceId)
        return unchanged("Provider returned a different food ID; skipped.");
      source = fromOFF(body.product);
    }
    if (!source)
      return unchanged(
        "Source nutrition could not be verified per 100 g; skipped.",
      );
    const added = nutrientKeys.filter(
      (key) =>
        key !== "freeSugar" &&
        product.nutrients[key] === undefined &&
        source.nutrients[key] !== undefined,
    );
    if (!added.length)
      return unchanged(
        "The source has no additional verified nutrient values.",
      );
    const provenance = `Enriched missing ${added.join(", ")} from ${product.source} ${sourceId} on ${new Date().toISOString().slice(0, 10)} (per 100 g).`;
    const notes = [product.notes, provenance].filter(Boolean).join("\n");
    if (notes.length > 2000)
      return unchanged(
        "Notes have no room for source provenance; enrichment skipped.",
      );
    const nutrients = { ...product.nutrients };
    for (const key of added) nutrients[key] = source.nutrients[key];
    return {
      product: productSchema.parse({ ...product, nutrients, notes }),
      added,
    };
  } catch {
    // Provider errors may contain API-key URLs. Never expose the original error.
    return unchanged(
      "Provider data unavailable or invalid; retry enrichment later.",
    );
  }
}
