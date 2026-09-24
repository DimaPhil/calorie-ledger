import { z } from "zod";

export const metricDefinitions = [
  {
    key: "calories",
    label: "Energy",
    unit: "kcal",
    target: 2100,
    min: 2000,
    max: 2200,
    kind: "target",
    source: "food",
    period: "day",
  },
  {
    key: "protein",
    label: "Protein",
    unit: "g",
    target: 160,
    min: 150,
    max: 180,
    kind: "minimum",
    source: "food",
    period: "day",
  },
  {
    key: "fat",
    label: "Fat",
    unit: "g",
    target: 70,
    min: 60,
    max: 80,
    kind: "target",
    source: "food",
    period: "day",
  },
  {
    key: "carbs",
    label: "Carbs",
    unit: "g",
    target: 208,
    kind: "target",
    source: "food",
    period: "day",
  },
  {
    key: "fiber",
    label: "Fiber",
    unit: "g",
    target: 30,
    max: 35,
    kind: "minimum",
    source: "food",
    period: "day",
  },
  {
    key: "beverages",
    label: "Drinks",
    unit: "ml",
    target: 2500,
    max: 3000,
    kind: "target",
    source: "checkin",
    period: "day",
  },
  {
    key: "fruitVeg",
    label: "Fruit & vegetables",
    unit: "g",
    target: 400,
    kind: "minimum",
    source: "checkin",
    period: "day",
  },
  {
    key: "saturatedFat",
    label: "Saturated fat",
    unit: "g",
    target: 20,
    kind: "limit",
    source: "food",
    period: "day",
  },
  {
    key: "freeSugar",
    label: "Free sugars",
    unit: "g",
    target: 25,
    kind: "limit",
    source: "food",
    period: "day",
  },
  {
    key: "sodium",
    label: "Sodium",
    unit: "mg",
    target: 2000,
    kind: "limit",
    source: "food",
    period: "day",
  },
  {
    key: "calcium",
    label: "Calcium",
    unit: "mg",
    target: 1000,
    kind: "minimum",
    source: "food",
    period: "day",
  },
  {
    key: "magnesium",
    label: "Magnesium",
    unit: "mg",
    target: 400,
    kind: "minimum",
    source: "food",
    period: "day",
  },
  {
    key: "potassium",
    label: "Potassium",
    unit: "mg",
    target: 3400,
    kind: "minimum",
    source: "food",
    period: "day",
  },
  {
    key: "vitaminD",
    label: "Vitamin D",
    unit: "µg",
    target: 15,
    kind: "minimum",
    source: "food",
    period: "day",
  },
  {
    key: "fish",
    label: "Fish",
    unit: "portions",
    target: 2,
    kind: "minimum",
    source: "checkin",
    period: "week",
  },
  {
    key: "sleep",
    label: "Sleep",
    unit: "h",
    target: 8,
    min: 7,
    kind: "minimum",
    source: "checkin",
    period: "day",
  },
] as const;
export const defaultGoals: Record<string, number> = Object.fromEntries(
  metricDefinitions.map((m) => [m.key, m.target]),
);
export const goalTargetsSchema = z
  .object(
    Object.fromEntries(
      metricDefinitions.map((m) => [
        m.key,
        z.number().finite().positive().max(100000),
      ]),
    ) as Record<(typeof metricDefinitions)[number]["key"], z.ZodNumber>,
  )
  .strict();
export type GoalSettings = {
  effectiveDate: string;
  targets: Record<string, number>;
};
export const checkInSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    complete: z.boolean(),
    beverages: z.number().min(0).max(20000).optional(),
    fruitVeg: z.number().min(0).max(10000).optional(),
    fish: z.number().min(0).max(20).optional(),
    weight: z.number().positive().max(500).optional(),
    waist: z.number().positive().max(300).optional(),
    sleep: z.number().min(0).max(24).optional(),
    energy: z.number().int().min(1).max(5).optional(),
  })
  .strict();
export type CheckIn = z.infer<typeof checkInSchema>;
export type GoalsData = {
  settings: GoalSettings;
  history: GoalSettings[];
  checkins: CheckIn[];
};
