import { useEffect, useState } from "react";
import {
  action,
  type Action,
  type Stats,
  type Product,
  type Nutrients,
} from "./shared";
import { Modal } from "./Modal.js";
import {
  metricDefinitions,
  defaultGoals,
  type GoalsData,
  type CheckIn,
  type GoalSettings,
} from "./goals-shared";
import "./goals.css";

const number = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
const shift = (date: string, amount: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
};
const monday = (date: string) =>
  shift(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
const goalsOn = (data: GoalsData, date: string) =>
  [...data.history]
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
    .find((g) => g.effectiveDate <= date)?.targets ?? defaultGoals;
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Please try again.";

export function GoalsDashboard({
  stats,
  today,
  onDay,
  revision,
}: {
  stats: Stats;
  today: string;
  onDay: (date: string) => void;
  revision: number;
}) {
  const [data, setData] = useState<GoalsData | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<{
    metric: (typeof metricDefinitions)[number];
    total: number;
    target: number;
    known: number;
    partial: boolean;
  } | null>(null);
  const single = stats.start === stats.end;
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    action<GoalsData>("get_goals" as Action, {
      start: stats.start,
      end: stats.end,
    })
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [stats.start, stats.end, revision, refresh]);
  useEffect(() => {
    const reload = () => setRefresh((n) => n + 1);
    window.addEventListener("ledger-goals-changed", reload);
    return () => window.removeEventListener("ledger-goals-changed", reload);
  }, []);
  if (error)
    return (
      <section className="panel goals-panel">
        <p role="alert">{error}</p>
        <button onClick={() => setRefresh((n) => n + 1)}>Retry goals</button>
      </section>
    );
  if (!data)
    return (
      <section className="panel goals-panel" aria-busy="true">
        <p>Loading goals…</p>
      </section>
    );
  const completeDays = stats.days.filter((d) =>
    data.checkins.some((c) => c.date === d.date && c.complete),
  );
  const selectedDays = single ? stats.days : completeDays;
  const current = data.checkins.find((c) => c.date === stats.start);
  const targetDate = single ? stats.start : stats.end;
  return (
    <section className="goals-panel" aria-label="Goal progress">
      <div className="section-heading">
        <h2>
          {single
            ? stats.start === today
              ? "Today’s targets"
              : "Daily targets"
            : "Daily averages"}
        </h2>
        <span>
          {single
            ? current?.complete
              ? "Day complete"
              : "In progress"
            : `${completeDays.length} / ${stats.days.length} days complete`}
        </span>
      </div>
      <p className="goals-intro">
        {single
          ? "At a glance: eaten, target and percentage. Limits show budget used."
          : "Averages use days you marked complete. Unlogged days are never treated as zero."}
      </p>
      <div className="metrics goal-grid" id="goal-metrics">
        {metricDefinitions
          .filter(
            (metric) =>
              expanded ||
              ["calories", "protein", "carbs", "fat"].includes(metric.key),
          )
          .map((metric) => {
            let total = 0;
            let known = 0;
            const expected = selectedDays.length;
            let target = 0;
            let partial = false;
            for (const day of selectedDays) {
              const value =
                metric.source === "food"
                  ? (day.nutrients as Record<string, number | undefined>)[
                      metric.key
                    ]
                  : (
                      data.checkins.find(
                        (c) => c.date === day.date,
                      ) as unknown as Record<string, unknown> | undefined
                    )?.[metric.key];
              if (
                typeof value === "number" &&
                (metric.source !== "food" || day.count > 0)
              ) {
                total += value;
                target += goalsOn(data, day.date)[metric.key];
                known++;
              }
              if (
                metric.source === "food" &&
                stats.entries
                  .filter((e) => e.date === day.date)
                  .some((e) =>
                    e.items.some(
                      (i) =>
                        (i.nutrients as Record<string, unknown>)[metric.key] ===
                        undefined,
                    ),
                  )
              )
                partial = true;
            }
            target = known
              ? target / known
              : goalsOn(data, targetDate)[metric.key];
            if (known) total /= known;
            partial ||= known < expected;
            const percent =
              known && target > 0 ? Math.round((total / target) * 100) : null;
            const over = metric.kind !== "minimum" && total > target;
            const status =
              percent === null
                ? "Not tracked"
                : over
                  ? `${metric.kind === "limit" ? "Above limit" : `${number(total - target)} ${metric.unit} above target`}${partial ? " · known values only" : ""}`
                  : partial
                    ? "Known values only"
                    : metric.kind === "limit"
                      ? "Budget used"
                      : metric.kind === "target" && total > target
                        ? `${number(total - target)} ${metric.unit} above target`
                        : total >= target
                          ? "Target reached"
                          : `${number(target - total)} ${metric.unit} to target`;
            return (
              <article
                key={metric.key}
                className={`goal-card ${over ? "goal-over" : ""} ${percent === null ? "goal-unknown" : ""}`}
              >
                <div className="goal-card-title">
                  <h3 aria-label={metric.label}>
                    <button
                      className="goal-detail-button"
                      aria-label={`Show ${metric.label.toLowerCase()} contributions`}
                      onClick={() =>
                        setDetail({ metric, total, target, known, partial })
                      }
                    >
                      {metric.label}
                    </button>
                  </h3>
                  <strong className="goal-percent">
                    {percent === null ? "—" : `${percent}%`}
                  </strong>
                </div>
                <div className="goal-amount">
                  <strong>{known ? number(total) : "—"}</strong>
                  <span>
                    {" "}
                    / {number(target)} {metric.unit}
                    {metric.kind === "limit" ? " limit" : ""}
                  </span>
                </div>
                <progress
                  max="100"
                  value={percent === null ? 0 : Math.min(percent, 100)}
                  aria-label={`${metric.label}: ${known ? `${number(total)} of ${number(target)} ${metric.unit}, ${percent}%${partial ? ", incomplete data" : ""}` : "not tracked"}`}
                />
                <small>
                  {status}
                  {!single && known ? ` · ${known} known days` : ""}
                </small>
              </article>
            );
          })}
      </div>
      {detail && (
        <Modal
          title={`${detail.metric.label}: where it comes from`}
          onClose={() => setDetail(null)}
        >
          <p className="goal-detail-total">
            <strong>
              {detail.known ? number(detail.total) : "—"} {detail.metric.unit}
            </strong>{" "}
            / {number(detail.target)} {detail.metric.unit}{" "}
            {detail.metric.kind === "limit"
              ? "limit"
              : detail.metric.kind === "minimum"
                ? "minimum"
                : "target"}
            {!single ? " per day" : ""}
          </p>
          <p>
            {detail.metric.kind === "limit"
              ? "This is an upper limit. Amber means the recorded amount exceeds it."
              : detail.metric.kind === "minimum"
                ? "This is a minimum goal. Going above it does not trigger an amber warning."
                : "This is a daily target. Amber means you are above it; it is a planning signal, not a safety limit."}
            {detail.metric.key === "saturatedFat" || detail.metric.key === "fat"
              ? " Saturated fat is part of total fat, not an additional amount."
              : ""}
          </p>
          {!single && (
            <p>
              {detail.known
                ? `Sum of recorded contributions ÷ ${detail.known} known days = the displayed daily average.`
                : "No known days in this interval."}{" "}
              Only days marked complete are included.
            </p>
          )}
          {detail.partial && (
            <p className="form-note">
              Some values are missing. The recorded total is a lower bound;
              unknown values are not zero.
            </p>
          )}
          {detail.metric.source === "food" ? (
            <>
              <p>
                Largest contributors first. Percentages show each entry’s share
                of the recorded total. Ingredient values already account for the
                amount eaten and any journal corrections.
              </p>
              <ol className="goal-contributors">
                {stats.entries
                  .filter((e) => selectedDays.some((d) => d.date === e.date))
                  .sort(
                    (a, b) =>
                      (b.nutrients[detail.metric.key as keyof Nutrients] ??
                        -1) -
                      (a.nutrients[detail.metric.key as keyof Nutrients] ?? -1),
                  )
                  .map((entry) => {
                    const value =
                      entry.nutrients[detail.metric.key as keyof Nutrients];
                    const share =
                      value !== undefined &&
                      detail.total > 0 &&
                      detail.known > 0
                        ? (value / (detail.total * detail.known)) * 100
                        : null;
                    return (
                      <li key={entry.id}>
                        <div className="contributor-heading">
                          <strong>{entry.name}</strong>
                          <strong>
                            {value === undefined
                              ? "Unknown"
                              : `${number(value)} ${detail.metric.unit}`}
                          </strong>
                        </div>
                        <small>
                          {entry.date} · {entry.meal} · {number(entry.amount)}{" "}
                          {entry.unit}
                          {share !== null
                            ? ` · ${number(share)}% of recorded total`
                            : ""}
                        </small>
                        {share !== null && (
                          <div className="contributor-bar" aria-hidden="true">
                            <span
                              style={{ width: `${Math.min(share, 100)}%` }}
                            />
                          </div>
                        )}
                        <ul>
                          {entry.items.map((item, index) => (
                            <li key={index}>
                              {item.name}: {number(item.grams)} g eaten →{" "}
                              <strong>
                                {item.nutrients[
                                  detail.metric.key as keyof Nutrients
                                ] === undefined
                                  ? "Unknown"
                                  : `${number(item.nutrients[detail.metric.key as keyof Nutrients]!)} ${detail.metric.unit}`}
                              </strong>
                            </li>
                          ))}
                        </ul>
                      </li>
                    );
                  })}
              </ol>
              {!stats.entries.some((e) =>
                selectedDays.some((d) => d.date === e.date),
              ) && <p>No food entries contribute in this view.</p>}
            </>
          ) : (
            <>
              <p>
                Source: daily check-in totals. These are entered directly; food
                records are not added again.
              </p>
              <ul>
                {selectedDays.map((day) => {
                  const value = data.checkins.find(
                    (c) => c.date === day.date,
                  )?.[detail.metric.key as "beverages" | "sleep"];
                  return (
                    <li key={day.date}>
                      {day.date}:{" "}
                      <strong>
                        {value === undefined
                          ? "Not recorded"
                          : `${number(value)} ${detail.metric.unit}`}
                      </strong>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Modal>
      )}
      <button
        className="text-button"
        aria-expanded={expanded}
        aria-controls="goal-metrics"
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? "Show less" : "Show more"}
      </button>
      {expanded && (
        <p className="goals-footnote">
          Missing values are unknown, not zero. Free sugars differ from total
          and added sugars. Drink totals are entered in the check-in; they are
          not added again from food records.
        </p>
      )}
      {single ? (
        <DailyCheckIn
          key={`${stats.start}:${refresh}`}
          date={stats.start}
          initial={current}
          onSaved={() => setRefresh((n) => n + 1)}
        />
      ) : (
        <section className="panel goals-trends">
          <h2>Across days</h2>
          <p>
            Select a day to review its journal. Mark a day complete after
            logging everything you ate.
          </p>
          <div className="goals-table-wrap">
            <table>
              <caption className="sr-only">
                Daily nutrition and body check-ins
              </caption>
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Energy</th>
                  <th>Protein</th>
                  <th>Weight</th>
                  <th>Sleep</th>
                  <th>Logging</th>
                </tr>
              </thead>
              <tbody>
                {stats.days.map((day) => {
                  const check = data.checkins.find((c) => c.date === day.date);
                  const kcal = day.nutrients.calories;
                  const goal = goalsOn(data, day.date).calories;
                  return (
                    <tr key={day.date}>
                      <th>
                        <button
                          className="text-button"
                          onClick={() => onDay(day.date)}
                        >
                          {day.date.slice(5)}
                        </button>
                      </th>
                      <td>
                        {kcal === undefined || !day.count ? (
                          "—"
                        ) : (
                          <>
                            <span>
                              {number(kcal)} kcal ·{" "}
                              {Math.round((kcal / goal) * 100)}%
                              {stats.entries
                                .filter((e) => e.date === day.date)
                                .some((e) =>
                                  e.items.some(
                                    (i) => i.nutrients.calories === undefined,
                                  ),
                                )
                                ? " · known only"
                                : ""}
                            </span>
                            <progress
                              aria-label={`Energy on ${day.date}`}
                              max={goal}
                              value={Math.min(kcal, goal)}
                            />
                          </>
                        )}
                      </td>
                      <td>
                        {day.nutrients.protein === undefined
                          ? "—"
                          : `${number(day.nutrients.protein)} g`}
                        {day.nutrients.protein !== undefined &&
                          stats.entries
                            .filter((e) => e.date === day.date)
                            .some((e) =>
                              e.items.some(
                                (i) => i.nutrients.protein === undefined,
                              ),
                            ) && <small> · known only</small>}
                      </td>
                      <td>
                        {check?.weight === undefined
                          ? "—"
                          : `${number(check.weight)} kg`}
                      </td>
                      <td>
                        {check?.sleep === undefined
                          ? "—"
                          : `${number(check.sleep)} h`}
                      </td>
                      <td>
                        {check?.complete
                          ? "Complete"
                          : day.count
                            ? "Partial"
                            : "Not logged"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <BodyTrend
            checkins={data.checkins.filter(
              (c) => c.date >= stats.start && c.date <= stats.end,
            )}
          />
        </section>
      )}
    </section>
  );
}

function BodyTrend({ checkins }: { checkins: CheckIn[] }) {
  const weights = checkins.filter((c) => c.weight !== undefined);
  const waists = checkins
    .filter((c) => c.waist !== undefined)
    .sort((a, b) => a.date.localeCompare(b.date));
  const weeks = [...new Set(weights.map((c) => monday(c.date)))].sort();
  const energies = checkins.filter((c) => c.energy !== undefined);
  return (
    <div className="body-trend">
      <h3>Body trends</h3>
      {weights.length ? (
        <p>
          {weeks.map((week) => {
            const values = weights.filter((c) => monday(c.date) === week);
            return (
              <span key={week}>
                Week of {week}:{" "}
                <strong>
                  {number(
                    values.reduce((sum, c) => sum + c.weight!, 0) /
                      values.length,
                  )}{" "}
                  kg
                </strong>{" "}
                average ({values.length} measurements).{" "}
              </span>
            );
          })}
        </p>
      ) : (
        <p>Add weight in a daily check-in to compare weekly averages.</p>
      )}
      {waists.length > 0 && (
        <p>
          Latest waist: <strong>{number(waists.at(-1)!.waist!)} cm</strong> on{" "}
          {waists.at(-1)!.date}.
        </p>
      )}
      {energies.length > 0 && (
        <p>
          Average energy / wellbeing:{" "}
          <strong>
            {number(
              energies.reduce((sum, c) => sum + c.energy!, 0) / energies.length,
            )}{" "}
            / 5
          </strong>{" "}
          ({energies.length} check-ins).
        </p>
      )}
      <small>
        Individual readings fluctuate. Goals only change when you edit them.
      </small>
    </div>
  );
}

function DailyCheckIn({
  date,
  initial,
  onSaved,
}: {
  date: string;
  initial?: CheckIn;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const fields = [
    { key: "beverages", label: "Drinks total (ml)", max: 20000 },
    { key: "weight", label: "Weight (kg)", max: 500 },
    { key: "waist", label: "Waist (cm)", max: 300 },
    { key: "sleep", label: "Sleep (hours)", max: 24 },
    { key: "energy", label: "Energy / wellbeing (1–5)", max: 5 },
  ];
  return (
    <details className="panel daily-checkin">
      <summary>
        Daily check-in{" "}
        <span>
          {initial?.complete ? "Complete" : "Drinks & body measurements"}
        </span>
      </summary>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const input: Record<string, unknown> = {
            date,
            complete: form.get("complete") === "on",
          };
          for (const field of fields) {
            const raw = form.get(field.key);
            if (raw !== "" && raw !== null) input[field.key] = Number(raw);
          }
          setBusy(true);
          setMessage("");
          try {
            await action("save_checkin" as Action, input);
            onSaved();
          } catch (e) {
            setMessage(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          Enter totals for this day, not amounts to add. Leave unknown values
          blank.
        </p>
        <div className="goal-form-grid">
          {fields.map((field) => (
            <label className="field" key={field.key}>
              <span>{field.label}</span>
              <input
                type="number"
                name={field.key}
                min={field.key === "energy" ? 1 : 0}
                max={field.max}
                step={field.key === "energy" ? 1 : "any"}
                defaultValue={
                  (initial as unknown as Record<string, number> | undefined)?.[
                    field.key
                  ] ?? ""
                }
              />
            </label>
          ))}
        </div>
        <label className="goal-complete">
          <input
            type="checkbox"
            name="complete"
            defaultChecked={initial?.complete}
          />{" "}
          I have finished logging this day
        </label>
        <button className="primary" disabled={busy}>
          {busy ? "Saving…" : "Save check-in"}
        </button>
        {message && <p role="alert">{message}</p>}
      </form>
    </details>
  );
}

export function GoalAdmin({ today }: { today: string }) {
  const [settings, setSettings] = useState<GoalSettings | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [enrichment, setEnrichment] = useState<string[]>([]);
  const [enriching, setEnriching] = useState(false);
  useEffect(() => {
    let active = true;
    action<GoalsData>("get_goals" as Action, { start: today, end: today })
      .then((data) => {
        if (active) setSettings(data.settings);
      })
      .catch((e) => {
        if (active) setMessage(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [today]);
  return (
    <section className="panel goal-admin">
      <h2>Goals & baseline</h2>
      <p>
        Your starting plan: 2,100 kcal, 160 g protein, 70 g fat and 208 g
        carbohydrates. Edit any target below. These are manually controlled
        starting targets, not automatic dietary advice.
      </p>
      <p>
        Record body measurements in your private daily check-in; they do not
        automatically adjust goals.
      </p>
      {settings && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const targets = Object.fromEntries(
              metricDefinitions.map((metric) => [
                metric.key,
                Number(form.get(metric.key)),
              ]),
            );
            setBusy(true);
            setMessage("");
            try {
              await action("save_goals" as Action, {
                effectiveDate: form.get("effectiveDate"),
                targets,
              });
              setMessage(
                "Goals saved. Earlier dates keep their previous targets.",
              );
              window.dispatchEvent(new Event("ledger-goals-changed"));
            } catch (e) {
              setMessage(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            <span>Apply starting on</span>
            <input
              type="date"
              name="effectiveDate"
              required
              defaultValue={today}
            />
          </label>
          <div className="goal-form-grid">
            {metricDefinitions.map((metric) => (
              <label className="field" key={metric.key}>
                <span>
                  {metric.label} ({metric.unit}/{metric.period})
                  {metric.kind === "limit"
                    ? " · upper limit"
                    : metric.kind === "minimum"
                      ? " · minimum"
                      : ""}
                </span>
                <input
                  type="number"
                  name={metric.key}
                  required
                  min="0.1"
                  max="100000"
                  step="any"
                  defaultValue={settings.targets[metric.key] ?? metric.target}
                />
                {"min" in metric && "max" in metric && (
                  <small>
                    Starting guide: {metric.min}–{metric.max} {metric.unit}
                  </small>
                )}
              </label>
            ))}
          </div>
          <p>
            Calories from your macros ≈ protein × 4 + carbs × 4 + fat × 9.
            Changing a target does not automatically change the others.
          </p>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save goals"}
          </button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
      <div className="body-trend">
        <h3>Saved food data</h3>
        <p>
          Fill missing nutrients from each food’s exact USDA or Open Food Facts
          record. Existing journal entries stay unchanged. Unsupported values
          remain unknown.
        </p>
        <button
          disabled={enriching}
          onClick={async () => {
            setEnriching(true);
            setEnrichment([]);
            try {
              const products = await action<Product[]>("list_products");
              if (!products.length)
                setEnrichment(["No saved foods to refresh."]);
              for (const product of products) {
                try {
                  const result = await action<{
                    added: string[];
                    warning?: string;
                  }>("save_enriched_product", { id: product.id });
                  setEnrichment((lines) => [
                    ...lines,
                    `${product.name}: ${result.added.length ? `added ${result.added.join(", ")}` : "no additional values"}${result.warning ? `. ${result.warning}` : ""}`,
                  ]);
                } catch (e) {
                  setEnrichment((lines) => [
                    ...lines,
                    `${product.name}: ${errorText(e)}`,
                  ]);
                }
              }
            } catch (e) {
              setEnrichment([errorText(e)]);
            } finally {
              setEnriching(false);
              window.dispatchEvent(new Event("ledger-foods-changed"));
            }
          }}
        >
          {enriching ? "Refreshing foods…" : "Refresh missing food nutrients"}
        </button>
        <div role="status" aria-live="polite">
          {enrichment.length > 0 && (
            <ul>
              {enrichment.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
