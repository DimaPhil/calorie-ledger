import { nutrientKeys, type Stats } from "./shared.js";

// A known subtotal is not a daily total: every recorded component must supply it.
export function nutritionProgress(stats: Stats) {
  const entriesByDay = new Map<string, Stats["entries"]>();
  for (const entry of stats.entries) {
    const entries = entriesByDay.get(entry.date) ?? [];
    entries.push(entry);
    entriesByDay.set(entry.date, entries);
  }
  const series = Object.fromEntries(
    nutrientKeys.map((key) => [
      key,
      stats.days.map((day) => {
        const entries = entriesByDay.get(day.date) ?? [];
        const partial =
          day.count > 0 &&
          (entries.length !== day.count ||
            entries.some(
              (entry) =>
                !entry.items.length ||
                entry.items.some((item) => item.nutrients[key] === undefined),
            ));
        return {
          date: day.date,
          value:
            day.count && (!partial || key === "calories")
              ? day.nutrients[key]
              : undefined,
          partial,
        };
      }),
    ]),
  ) as Record<
    (typeof nutrientKeys)[number],
    { date: string; value: number | undefined; partial: boolean }[]
  >;
  return {
    series,
    available: nutrientKeys.filter(
      (key) =>
        key !== "calories" &&
        series[key].some((point) => point.value !== undefined),
    ),
    loggedDays: stats.days.filter((day) => day.count > 0).length,
  };
}
