import { expect, it } from "vitest";
import { nutritionProgress } from "../src/progress-data.js";
import type { Entry, Stats } from "../src/shared.js";

it("charts only fully known daily nutrient totals, preserving zero and gaps", () => {
  const stats: Stats = {
    start: "2026-09-24",
    end: "2026-09-26",
    totals: {},
    missingNutrients: [],
    days: [
      {
        date: "2026-09-24",
        count: 1,
        nutrients: { calories: 100, fiber: 0, cholesterol: 5 },
      },
      {
        date: "2026-09-25",
        count: 1,
        nutrients: { calories: 200, fiber: 3, cholesterol: 10 },
      },
      { date: "2026-09-26", count: 0, nutrients: { fiber: 0 } },
    ],
    entries: [
      {
        date: "2026-09-24",
        items: [{ nutrients: { calories: 100, fiber: 0, cholesterol: 5 } }],
      },
      {
        date: "2026-09-25",
        items: [
          { nutrients: { calories: 200, fiber: 3, cholesterol: 10 } },
          { nutrients: {} },
        ],
      },
    ] as Entry[],
  };
  const result = nutritionProgress(stats);
  expect(result.available).toEqual(["fiber", "cholesterol"]);
  expect(result.loggedDays).toBe(2);
  expect(result.series.fiber.map((point) => point.value)).toEqual([
    0,
    undefined,
    undefined,
  ]);
  expect(result.series.fiber[1].partial).toBe(true);
  expect(result.series.calories[1]).toMatchObject({
    value: 200,
    partial: true,
  });
  // Changing the selected period must remove metrics whose only reliable day left the view.
  expect(
    nutritionProgress({
      ...stats,
      days: stats.days.slice(1),
      entries: stats.entries.slice(1),
    }).available,
  ).toEqual([]);
});

it("does not advertise totals when component records are absent", () => {
  const stats: Stats = {
    start: "2026-09-24",
    end: "2026-09-24",
    totals: {},
    missingNutrients: [],
    days: [{ date: "2026-09-24", count: 1, nutrients: { protein: 20 } }],
    entries: [],
  };
  expect(nutritionProgress(stats).available).toEqual([]);
  expect(
    nutritionProgress({
      ...stats,
      entries: [{ date: "2026-09-24", items: [] } as unknown as Entry],
    }).available,
  ).toEqual([]);
});
