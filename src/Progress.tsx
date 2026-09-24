import { useEffect, useState } from "react";
import { DateTime } from "luxon";
import { action, type Stats, type Nutrients } from "./shared";
import {
  defaultGoals,
  metricDefinitions,
  type GoalsData,
} from "./goals-shared";
import "./progress.css";

export const PROGRESS_START_DATE = "2026-09-24";
const format = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
const label = (date: string) => DateTime.fromISO(date).toFormat("MMM d");
type Point = {
  date: string;
  value?: number;
  target?: number;
  complete?: boolean;
  partial?: boolean;
  average?: number;
};
const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined;

function Chart({
  points,
  unit,
  title,
  bars = false,
  onDay,
}: {
  points: Point[];
  unit: string;
  title: string;
  bars?: boolean;
  onDay: (date: string) => void;
}) {
  const values = points.flatMap((p) =>
    [p.value, p.target, p.average].filter((v): v is number => v !== undefined),
  );
  const hasData = points.some((p) => p.value !== undefined);
  const highest = values.length ? Math.max(...values) : 1;
  const lowest = values.length ? Math.min(...values) : 0;
  const padding = Math.max((highest - lowest) * 0.15, 1);
  const max = bars ? Math.max(highest, 1) * 1.12 : highest + padding;
  const min = bars ? 0 : Math.max(0, lowest - padding);
  const x = (i: number) =>
    42 + (points.length === 1 ? 222 : (i * 444) / (points.length - 1));
  const y = (value: number) => 174 - ((value - min) / (max - min)) * 146;
  return (
    <>
      {hasData ? (
        <figure
          className="progress-figure"
          aria-label={`${title}. Exact values and journal links are available in Show daily values.`}
        >
          <svg
            viewBox="0 0 510 210"
            role="img"
            aria-label={`${title}, ${label(points[0].date)} to ${label(points.at(-1)!.date)}. ${points.filter((p) => p.value !== undefined).length} recorded days.`}
          >
            {[0, 0.5, 1].map((fraction) => (
              <g key={fraction}>
                <line
                  x1="42"
                  x2="486"
                  y1={174 - fraction * 146}
                  y2={174 - fraction * 146}
                  className="progress-gridline"
                />
                <text x="34" y={178 - fraction * 146} textAnchor="end">
                  {format(min + (max - min) * fraction)}
                </text>
              </g>
            ))}
            {points.map((p, i) => (
              <g key={p.date}>
                {p.target !== undefined && (i === 0 || points.length === 1) && (
                  <line
                    x1={points.length === 1 ? 42 : x(i)}
                    x2={points.length === 1 ? 486 : x(i)}
                    y1={y(p.target)}
                    y2={y(p.target)}
                    className="progress-target"
                  />
                )}
                {i > 0 &&
                  p.target !== undefined &&
                  points[i - 1].target !== undefined && (
                    <path
                      d={`M ${x(i - 1)} ${y(points[i - 1].target!)} H ${x(i)} V ${y(p.target)}`}
                      className="progress-target"
                    />
                  )}
                {p.value !== undefined && (
                  <>
                    {!bars && i > 0 && points[i - 1].value !== undefined && (
                      <line
                        x1={x(i - 1)}
                        y1={y(points[i - 1].value!)}
                        x2={x(i)}
                        y2={y(p.value)}
                        className="progress-line"
                      />
                    )}
                    {bars ? (
                      <rect
                        x={x(i) - Math.min(13, 170 / points.length)}
                        y={Math.min(y(p.value), 172)}
                        width={Math.min(26, 340 / points.length)}
                        height={Math.max(2, 174 - y(p.value))}
                        rx="3"
                        className={
                          p.complete && !p.partial
                            ? "progress-bar"
                            : "progress-bar progress-bar-partial"
                        }
                      >
                        <title>
                          {label(p.date)}: {format(p.value)} {unit}
                          {p.partial ? " · incomplete nutrition" : ""}
                          {p.complete ? " · day complete" : " · in progress"}
                        </title>
                      </rect>
                    ) : (
                      <circle
                        cx={x(i)}
                        cy={y(p.value)}
                        r="4"
                        className="progress-dot"
                      >
                        <title>
                          {label(p.date)}: {format(p.value)} {unit}
                        </title>
                      </circle>
                    )}
                  </>
                )}
                {p.average !== undefined && (
                  <circle
                    cx={x(i)}
                    cy={y(p.average)}
                    r="5"
                    className="progress-average"
                  >
                    <title>
                      Week to date average: {format(p.average)} {unit}
                    </title>
                  </circle>
                )}
              </g>
            ))}
            <text x="42" y="202">
              {label(points[0].date)}
            </text>
            <text x="486" y="202" textAnchor="end">
              {label(points.at(-1)!.date)}
            </text>
          </svg>
        </figure>
      ) : (
        <div className="progress-empty">
          No {title.toLowerCase()} recorded yet.
          <span>Open a day below to add your first record.</span>
        </div>
      )}
      <details className="progress-data">
        <summary>Show daily values</summary>
        <div className="progress-table-wrap">
          <table>
            <caption>
              {title} · {unit}
            </caption>
            <thead>
              <tr>
                <th>Day</th>
                <th>Recorded</th>
                {points.some((p) => p.target !== undefined) && (
                  <th>Goal / limit</th>
                )}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.date}>
                  <th>
                    <button
                      className="text-button"
                      onClick={() => onDay(p.date)}
                    >
                      {label(p.date)}
                    </button>
                  </th>
                  <td>{p.value === undefined ? "—" : format(p.value)}</td>
                  {points.some((d) => d.target !== undefined) && (
                    <td>{p.target === undefined ? "—" : format(p.target)}</td>
                  )}
                  <td>
                    {p.value === undefined
                      ? "Not recorded"
                      : p.partial
                        ? "Missing nutrition"
                        : bars
                          ? p.complete
                            ? "Complete"
                            : "In progress"
                          : "Recorded"}
                    {p.average !== undefined
                      ? ` · weekly mean ${format(p.average)}`
                      : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

export function Progress({
  today,
  revision,
  onDay,
}: {
  today: string;
  revision: number;
  onDay: (date: string) => void;
}) {
  const [windowDays, setWindowDays] = useState(30);
  const [nutrient, setNutrient] = useState("protein");
  const [recovery, setRecovery] = useState("sleep");
  const [body, setBody] = useState("weight");
  const [data, setData] = useState<{ stats: Stats; goals: GoalsData } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const start = [
    PROGRESS_START_DATE,
    DateTime.fromISO(today)
      .minus({ days: windowDays - 1 })
      .toISODate()!,
  ]
    .sort()
    .at(-1)!;
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    if (start > today) return;
    Promise.all([
      action<Stats>("get_stats", { start, end: today }),
      action<GoalsData>("get_goals", { start, end: today }),
    ])
      .then(([stats, goals]) => {
        if (active) setData({ stats, goals });
      })
      .catch((e: unknown) => {
        if (active)
          setError(e instanceof Error ? e.message : "Unable to load progress.");
      });
    return () => {
      active = false;
    };
  }, [start, today, revision, retry]);
  useEffect(() => {
    const refresh = () => setRetry((v) => v + 1);
    window.addEventListener("ledger-goals-changed", refresh);
    return () => window.removeEventListener("ledger-goals-changed", refresh);
  }, []);
  const toolbar = (
    <div className="progress-heading">
      <div>
        <p>
          Your trends begin {label(PROGRESS_START_DATE)}. Every recorded day
          adds to the picture.
        </p>
      </div>
      <div className="progress-ranges" aria-label="Progress period">
        {[7, 30, 90].map((days) => (
          <button
            key={days}
            aria-pressed={days === windowDays}
            onClick={() => setWindowDays(days)}
          >
            {days} days
          </button>
        ))}
      </div>
    </div>
  );
  if (start > today)
    return (
      <section className="progress-page">
        {toolbar}
        <p>Progress tracking begins {label(PROGRESS_START_DATE)}.</p>
      </section>
    );
  if (error)
    return (
      <section className="progress-page">
        {toolbar}
        <div className="panel">
          <p role="alert">{error}</p>
          <button onClick={() => setRetry((v) => v + 1)}>Retry progress</button>
        </div>
      </section>
    );
  if (!data)
    return (
      <section className="progress-page">
        {toolbar}
        <p role="status">Loading progress…</p>
      </section>
    );
  const { stats, goals } = data;
  const days = stats.days;
  const checkin = (date: string) => goals.checkins.find((c) => c.date === date);
  const targets = (date: string) =>
    [...goals.history]
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
      .find((g) => g.effectiveDate <= date)?.targets ?? defaultGoals;
  const foodPoints = (key: string): Point[] =>
    days.map((day) => ({
      date: day.date,
      value: day.count ? day.nutrients[key as keyof Nutrients] : undefined,
      target: targets(day.date)[key],
      complete: checkin(day.date)?.complete ?? false,
      partial: stats.entries
        .filter((e) => e.date === day.date)
        .some((e) =>
          e.items.some(
            (item) => item.nutrients[key as keyof Nutrients] === undefined,
          ),
        ),
    }));
  const caloriePoints = foodPoints("calories");
  const nutrientPoints = foodPoints(nutrient);
  const average = (points: Point[]) =>
    mean(
      points
        .filter((p) => p.complete && !p.partial && p.value !== undefined)
        .map((p) => p.value!),
    );
  const knownCount = (points: Point[]) =>
    points.filter((p) => p.complete && !p.partial && p.value !== undefined)
      .length;
  const completeCount = days.filter((d) => checkin(d.date)?.complete).length;
  const recordedCount = days.filter((d) => checkin(d.date)).length;
  const nutrientDef = metricDefinitions.find((m) => m.key === nutrient)!;
  const bodyPoints: Point[] = days.map((day) => ({
    date: day.date,
    value: checkin(day.date)?.[body as "weight" | "waist"],
  }));
  for (const point of bodyPoints) {
    if (point.value === undefined) continue;
    const week = DateTime.fromISO(point.date).startOf("week").toISODate()!;
    const laterInWeek = bodyPoints.some(
      (p) =>
        p.value !== undefined &&
        p.date > point.date &&
        DateTime.fromISO(p.date).startOf("week").toISODate() === week,
    );
    if (!laterInWeek)
      point.average = mean(
        bodyPoints
          .filter(
            (p) =>
              p.date >= week && p.date <= point.date && p.value !== undefined,
          )
          .map((p) => p.value!),
      );
  }
  const recoveryLabel =
    recovery === "beverages"
      ? "Drinks"
      : recovery === "sleep"
        ? "Sleep"
        : "Wellbeing";
  const recoveryUnit =
    recovery === "beverages" ? "ml" : recovery === "sleep" ? "h" : "/ 5";
  const recoveryPoints: Point[] = days.map((day) => ({
    date: day.date,
    value: checkin(day.date)?.[recovery as "sleep" | "beverages" | "energy"],
    target: recovery === "energy" ? undefined : targets(day.date)[recovery],
  }));
  return (
    <section className="progress-page">
      {toolbar}
      <section
        className="panel progress-consistency"
        aria-label="Check-in consistency"
      >
        <div className="progress-panel-heading">
          <div>
            <span className="progress-eyebrow">Showing up</span>
            <h2>Daily check-ins</h2>
          </div>
          <div className="progress-big">
            {recordedCount}
            <small> / {days.length} days</small>
          </div>
        </div>
        <p>
          {Math.round((recordedCount / Math.max(days.length, 1)) * 100)}%
          checked in · {completeCount} food days marked complete. Tap a day to
          open its journal and check-in.
        </p>
        <div className="progress-calendar">
          {days.map((day) => (
            <button
              key={day.date}
              className={
                checkin(day.date) ? "progress-day recorded" : "progress-day"
              }
              onClick={() => onDay(day.date)}
              aria-label={`${label(day.date)}: ${checkin(day.date) ? "checked in" : "no check-in"}${checkin(day.date)?.complete ? ", food day complete" : ""}`}
            >
              <span>{DateTime.fromISO(day.date).toFormat("ccc")}</span>
              <strong>{label(day.date)}</strong>
              <span aria-hidden="true">
                {checkin(day.date)?.complete
                  ? "✓"
                  : checkin(day.date)
                    ? "●"
                    : "·"}
              </span>
            </button>
          ))}
        </div>
      </section>
      <div className="progress-panels">
        <section className="panel">
          <span className="progress-eyebrow">Your daily budget</span>
          <h2>Calories over days</h2>
          <div className="progress-big">
            {average(caloriePoints) === undefined
              ? "—"
              : format(average(caloriePoints)!)}
            <small> kcal / day</small>
          </div>
          <p>
            Average from {knownCount(caloriePoints)} complete days with known
            calories. Hollow bars are still in progress or have missing
            nutrition.
          </p>
          <Chart
            title="Calories"
            unit="kcal"
            points={caloriePoints}
            bars
            onDay={onDay}
          />
          <div className="progress-legend">
            <span>
              <i />
              Complete
            </span>
            <span>
              <i className="hollow" />
              Partial
            </span>
            <span>
              <i className="dashed" />
              Daily target
            </span>
          </div>
        </section>
        <section className="panel">
          <div className="progress-panel-heading">
            <div>
              <span className="progress-eyebrow">Nutrition consistency</span>
              <h2>Nutrients over days</h2>
            </div>
            <label className="progress-select">
              <span className="sr-only">Nutrient</span>
              <select
                value={nutrient}
                onChange={(e) => setNutrient(e.target.value)}
              >
                {metricDefinitions
                  .filter((m) => m.source === "food" && m.key !== "calories")
                  .map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div className="progress-big">
            {average(nutrientPoints) === undefined
              ? "—"
              : format(average(nutrientPoints)!)}
            <small> {nutrientDef.unit} / day</small>
          </div>
          <p>
            Average from {knownCount(nutrientPoints)} complete days with fully
            known {nutrientDef.label.toLowerCase()}. Dashed line:{" "}
            {nutrientDef.kind === "limit" ? "upper limit" : "daily target"}.
          </p>
          <Chart
            title={nutrientDef.label}
            unit={nutrientDef.unit}
            points={nutrientPoints}
            bars
            onDay={onDay}
          />
        </section>
        <section className="panel">
          <div className="progress-panel-heading">
            <div>
              <span className="progress-eyebrow">The longer view</span>
              <h2>Body measurements</h2>
            </div>
            <label className="progress-select">
              <span className="sr-only">Body measurement</span>
              <select value={body} onChange={(e) => setBody(e.target.value)}>
                <option value="weight">Weight</option>
                <option value="waist">Waist</option>
              </select>
            </label>
          </div>
          <div className="progress-big">
            {bodyPoints.filter((p) => p.value !== undefined).at(-1)?.value ===
            undefined
              ? "—"
              : format(
                  bodyPoints.filter((p) => p.value !== undefined).at(-1)!
                    .value!,
                )}
            <small> {body === "weight" ? "kg" : "cm"} latest</small>
          </div>
          <p>
            Solid dots are your measurements; outlined dots are weekly averages
            within this view. Gaps stay empty.
          </p>
          <Chart
            title={body === "weight" ? "Weight" : "Waist"}
            unit={body === "weight" ? "kg" : "cm"}
            points={bodyPoints}
            onDay={onDay}
          />
        </section>
        <section className="panel">
          <div className="progress-panel-heading">
            <div>
              <span className="progress-eyebrow">Daily rhythm</span>
              <h2>Rest & hydration</h2>
            </div>
            <label className="progress-select">
              <span className="sr-only">Daily rhythm metric</span>
              <select
                value={recovery}
                onChange={(e) => setRecovery(e.target.value)}
              >
                <option value="sleep">Sleep</option>
                <option value="beverages">Drinks</option>
                <option value="energy">Wellbeing</option>
              </select>
            </label>
          </div>
          <div className="progress-big">
            {mean(
              recoveryPoints.flatMap((p) =>
                p.value === undefined ? [] : [p.value],
              ),
            ) === undefined
              ? "—"
              : format(
                  mean(
                    recoveryPoints.flatMap((p) =>
                      p.value === undefined ? [] : [p.value],
                    ),
                  )!,
                )}
            <small> {recoveryUnit} average</small>
          </div>
          <p>
            Based on{" "}
            {recoveryPoints.filter((p) => p.value !== undefined).length}{" "}
            recorded days. Missing check-ins do not count as zero.
          </p>
          <Chart
            title={recoveryLabel}
            unit={recoveryUnit}
            points={recoveryPoints}
            onDay={onDay}
          />
        </section>
      </div>
      <p className="progress-footnote">
        Targets follow the settings effective on each day. Nutrition averages
        exclude unfinished days and missing values. Progress is a record, not an
        automatic adjustment to your goals.
      </p>
    </section>
  );
}
