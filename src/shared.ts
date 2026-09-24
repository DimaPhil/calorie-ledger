import { z } from "zod";

export const nutrientKeys = [
  "calories",
  "protein",
  "carbs",
  "fat",
  "saturatedFat",
  "transFat",
  "sugar",
  "addedSugar",
  "fiber",
  "sodium",
  "cholesterol",
  "potassium",
  "calcium",
  "iron",
  "vitaminC",
  "vitaminD",
] as const;
export const nutrientLabels: Record<(typeof nutrientKeys)[number], string> = {
  calories: "Energy (kcal)",
  protein: "Protein (g)",
  carbs: "Carbs (g)",
  fat: "Fat (g)",
  saturatedFat: "Saturated fat (g)",
  transFat: "Trans fat (g)",
  sugar: "Sugar (g)",
  addedSugar: "Added sugar (g)",
  fiber: "Fiber (g)",
  sodium: "Sodium (mg)",
  cholesterol: "Cholesterol (mg)",
  potassium: "Potassium (mg)",
  calcium: "Calcium (mg)",
  iron: "Iron (mg)",
  vitaminC: "Vitamin C (mg)",
  vitaminD: "Vitamin D (µg)",
};
export const units = [
  "g",
  "kg",
  "oz",
  "lb",
  "ml",
  "l",
  "tsp",
  "tbsp",
  "cup",
  "fl_oz",
  "piece",
  "serving",
] as const;
export const unitSchema = z.enum(units);
export const nutrientsSchema = z
  .object(
    Object.fromEntries(
      nutrientKeys.map((k) => [
        k,
        z.number().finite().min(0).max(100000).optional(),
      ]),
    ) as Record<(typeof nutrientKeys)[number], z.ZodOptional<z.ZodNumber>>,
  )
  .strict();
export const portionSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    unit: unitSchema,
    grams: z.number().positive().max(100000),
  })
  .strict();
export const productSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    brand: z.string().trim().max(150).default(""),
    barcode: z.string().trim().max(40).optional(),
    nutrients: nutrientsSchema,
    portions: z.array(portionSchema).max(20).default([]),
    source: z.enum(["custom", "openfoodfacts", "usda"]).default("custom"),
    sourceId: z.string().max(100).optional(),
    notes: z.string().max(2000).default(""),
  })
  .strict();
export const quantitySchema = z
  .object({
    amount: z.number().positive().max(100000),
    unit: unitSchema,
    portionLabel: z.string().max(80).optional(),
  })
  .strict();
export const ingredientSchema = quantitySchema.extend({ productId: z.uuid() });
export const dishSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    ingredients: z.array(ingredientSchema).min(1).max(100),
    servings: z.number().positive().max(1000).default(1),
    cookedWeight: z.number().positive().max(100000).optional(),
    notes: z.string().max(2000).default(""),
  })
  .strict();
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const logSchema = quantitySchema
  .extend({
    productId: z.uuid().optional(),
    dishId: z.uuid().optional(),
    ingredients: z.array(ingredientSchema).min(1).max(100).optional(),
    date: dateSchema,
    meal: z.enum(["breakfast", "lunch", "dinner", "snack"]).default("snack"),
    notes: z.string().max(2000).default(""),
    idempotencyKey: z.string().min(8).max(100),
    query: z.string().trim().max(200).optional(),
  })
  .refine((v) => Number(!!v.productId) + Number(!!v.dishId) === 1, {
    message: "Choose exactly one productId or dishId.",
  });
export type Nutrients = Partial<Record<(typeof nutrientKeys)[number], number>>;
export type ProductInput = z.infer<typeof productSchema>;
export type Product = ProductInput & { id: string; updatedAt: string };
export type Quantity = z.infer<typeof quantitySchema>;
export type DishInput = z.infer<typeof dishSchema>;
export type Dish = DishInput & { id: string; updatedAt: string };
export type LogInput = z.infer<typeof logSchema>;
export type Entry = {
  id: string;
  revision?: number;
  name: string;
  date: string;
  meal: string;
  amount: number;
  unit: string;
  nutrients: Nutrients;
  notes: string;
  items: { name: string; grams: number; nutrients: Nutrients }[];
  createdAt: string;
};
export type User = {
  id: string;
  username: string;
  timezone: string;
  unitSystem: "metric" | "us";
};
export type SearchResult = {
  status: "matched" | "choose" | "not_found";
  query: string;
  candidates: Product[];
  preferredProductId: string | null;
  matchType: "confirmed_alias" | "exact_saved" | "none";
  requiresProductConfirmation: boolean;
  reason: string;
  warnings: string[];
};
export type Stats = {
  start: string;
  end: string;
  totals: Nutrients;
  days: { date: string; nutrients: Nutrients; count: number }[];
  entries: Entry[];
  missingNutrients: string[];
};

// Web POST /api/actions/:action and MCP tools share these action names/arguments.
export const entryUpdateSchema = z
  .object({
    id: z.uuid(),
    date: dateSchema,
    meal: z.enum(["breakfast", "lunch", "dinner", "snack"]),
    notes: z.string().max(2000),
    expectedRevision: z.number().int().min(0).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    amount: z.number().positive().max(100000).optional(),
    unit: unitSchema.optional(),
    items: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(200),
            grams: z.number().positive().max(100000),
            nutrients: nutrientsSchema.extend({
              calories: z.number().finite().min(0).max(100000),
            }),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .optional(),
  })
  .strict()
  .refine(
    (v) =>
      (v.name === undefined &&
        v.amount === undefined &&
        v.unit === undefined &&
        v.items === undefined) ||
      v.expectedRevision !== undefined,
    {
      message:
        "Snapshot corrections require expectedRevision from the current entry.",
    },
  )
  .refine(
    (v) =>
      (v.amount === undefined && v.unit === undefined) || v.items !== undefined,
    {
      message: "Quantity corrections require the complete component snapshot.",
    },
  );
export type EntryUpdate = z.infer<typeof entryUpdateSchema>;
export const actionSchemas = {
  list_products: z.object({}).strict(),
  search_products: z
    .object({
      query: z.string().trim().min(1).max(200),
      external: z.boolean().default(true),
      broaden: z.boolean().default(false),
    })
    .strict(),
  save_product: z
    .object({ id: z.uuid().optional(), product: productSchema })
    .strict(),
  delete_product: z.object({ id: z.uuid() }).strict(),
  remember_choice: z
    .object({ query: z.string().trim().min(1).max(200), productId: z.uuid() })
    .strict(),
  list_dishes: z.object({}).strict(),
  save_dish: z.object({ id: z.uuid().optional(), dish: dishSchema }).strict(),
  delete_dish: z.object({ id: z.uuid() }).strict(),
  preview_dish: z.object({ dish: dishSchema }).strict(),
  resolve_food: z
    .object({
      query: z.string().trim().min(1).max(200),
      amount: z.number().positive().optional(),
      unit: unitSchema.optional(),
      portionLabel: z.string().max(80).optional(),
    })
    .strict(),
  log_food: logSchema,
  delete_entry: z.object({ id: z.uuid() }).strict(),
  update_entry: entryUpdateSchema,
  get_stats: z.object({ start: dateSchema, end: dateSchema }).strict(),
  get_profile: z.object({}).strict(),
  update_profile: z
    .object({
      timezone: z.string().min(1).max(80),
      unitSystem: z.enum(["metric", "us"]),
    })
    .strict(),
} as const;
export type Action = keyof typeof actionSchemas;

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...(body !== undefined
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.error?.message || "Something went wrong. Please try again.",
    );
  return result;
}
export const action = <T>(name: Action, args: unknown = {}) =>
  api<T>(`/api/actions/${name}`, args);
