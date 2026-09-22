import { DateTime } from "luxon";
import {
  nutrientKeys,
  type Nutrients,
  type Product,
  type Quantity,
} from "../src/shared.js";

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function normalize(text: string) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
const mass: Record<string, number> = {
  g: 1,
  kg: 1000,
  oz: 28.349523125,
  lb: 453.59237,
};
const volume: Record<string, number> = {
  ml: 1,
  l: 1000,
  tsp: 4.92892159375,
  tbsp: 14.78676478125,
  cup: 236.5882365,
  fl_oz: 29.5735295625,
};
export function grams(product: Product, quantity: Quantity): number {
  if (mass[quantity.unit]) return quantity.amount * mass[quantity.unit];
  const portions = product.portions.filter(
    (p) => !quantity.portionLabel || p.label === quantity.portionLabel,
  );
  const exact = portions.filter((p) => p.unit === quantity.unit);
  if (exact.length === 1) return quantity.amount * exact[0].grams;
  if (exact.length === 0 && volume[quantity.unit]) {
    const compatible = portions.filter((p) => volume[p.unit]);
    if (compatible.length === 1)
      return (
        (quantity.amount * volume[quantity.unit] * compatible[0].grams) /
        volume[compatible[0].unit]
      );
  }
  throw new AppError(
    "clarification_required",
    `How much does this ${quantity.unit} of ${product.name} weigh? Choose a saved portion or provide grams.`,
    422,
    {
      missing: ["grams or an unambiguous saved portion"],
      portions: product.portions,
      productId: product.id,
    },
  );
}
export function scale(nutrients: Nutrients, factor: number): Nutrients {
  return Object.fromEntries(
    Object.entries(nutrients).map(([key, value]) => [key, value! * factor]),
  );
}
export function sum(values: Nutrients[]): Nutrients {
  return Object.fromEntries(
    nutrientKeys.flatMap((key) => {
      const known = values.map((v) => v[key]).filter((v) => v !== undefined);
      return known.length ? [[key, known.reduce((a, b) => a + b, 0)]] : [];
    }),
  );
}
export function validateDate(date: string) {
  if (
    !DateTime.fromISO(date).isValid ||
    DateTime.fromISO(date).toISODate() !== date
  )
    throw new AppError(
      "invalid_date",
      "Use a valid date in YYYY-MM-DD format.",
    );
}
export function range(start: string, end: string) {
  validateDate(start);
  validateDate(end);
  const count = DateTime.fromISO(end).diff(
    DateTime.fromISO(start),
    "days",
  ).days;
  if (count < 0 || count > 365)
    throw new AppError(
      "invalid_range",
      "Choose a date range of up to 366 days, with the end on or after the start.",
    );
  return Array.from({ length: count + 1 }, (_, i) =>
    DateTime.fromISO(start).plus({ days: i }).toISODate()!,
  );
}
