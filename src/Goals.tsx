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
  type GoalSettings,
} from "./goals-shared";
import "./goals.css";
import { useI18n, localizeLabel, localizeError } from "./i18n.js";

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Please try again.";
const goalsSaved = "Goals saved. Earlier dates keep their previous targets.";

function useGoalText() {
  const { t, locale, language } = useI18n();
  return {
    t,
    number: (value: number) =>
      new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value),
    dateText: (date: string) =>
      new Intl.DateTimeFormat(locale, {
        timeZone: "UTC",
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(new Date(`${date}T12:00:00Z`)),
    label: (value: string) => localizeLabel(value, language),
    messageText: (message: string) =>
      message === goalsSaved
        ? t(
            goalsSaved,
            "Цели сохранены. Для предыдущих дат остаются прежние цели.",
          )
        : localizeError(message, language),
  };
}
const goalsOn = (data: GoalsData, date: string) =>
  [...data.history]
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
    .find((g) => g.effectiveDate <= date)?.targets ?? defaultGoals;

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
  const { t, number, dateText, label, messageText } = useGoalText();
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
        <p role="alert">{messageText(error)}</p>
        <button onClick={() => setRefresh((n) => n + 1)}>
          {t("Retry goals", "Загрузить цели снова")}
        </button>
      </section>
    );
  if (!data)
    return (
      <section className="panel goals-panel" aria-busy="true">
        <p>{t("Loading goals…", "Загрузка целей…")}</p>
      </section>
    );
  const selectedDays = stats.days.filter((day) => day.count > 0);
  const eligibleDay = (date: string, key: keyof Nutrients) =>
    single ||
    !stats.entries
      .filter((e) => e.date === date)
      .some((e) => e.items.some((i) => i.nutrients[key] === undefined));
  const targetDate = single ? stats.start : stats.end;
  return (
    <section
      className="goals-panel"
      aria-label={t("Goal progress", "Прогресс по целям")}
    >
      <div className="section-heading">
        <h2>
          {single
            ? stats.start === today
              ? t("Today’s targets", "Цели на сегодня")
              : t("Daily targets", "Цели на день")
            : t("Daily averages", "Среднее за день")}
        </h2>
        <span>
          {t(
            `Days logged: ${selectedDays.length}`,
            `Дней с записями: ${selectedDays.length}`,
          )}
        </span>
      </div>
      <p className="goals-intro">
        {single
          ? t(
              "At a glance: eaten, target and percentage. Limits show budget used.",
              "Съедено, цель и процент. Для ограничений показана использованная доля.",
            )
          : t(
              "Averages use logged days with known nutrition for each nutrient. Unlogged days are never treated as zero.",
              "Среднее рассчитано по дням с известными значениями выбранного нутриента. Дни без записей не считаются нулевыми.",
            )}
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
              const value = day.nutrients[metric.key as keyof Nutrients];
              const missing = stats.entries
                .filter((e) => e.date === day.date)
                .some((e) =>
                  e.items.some(
                    (i) =>
                      i.nutrients[metric.key as keyof Nutrients] === undefined,
                  ),
                );
              if (!single && missing) continue;
              if (typeof value === "number") {
                total += value;
                target += goalsOn(data, day.date)[metric.key];
                known++;
              }
              if (
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
                ? t("Not tracked", "Не отслеживается")
                : over
                  ? `${metric.kind === "limit" ? t("Above limit", "Выше ограничения") : t(`${number(total - target)} ${label(metric.unit)} above target`, `На ${number(total - target)} ${label(metric.unit)} выше цели`)}${partial ? t(" · known values only", " · только известные значения") : ""}`
                  : partial
                    ? t("Known values only", "Только известные значения")
                    : metric.kind === "limit"
                      ? t("Budget used", "Использовано")
                      : metric.kind === "target" && total > target
                        ? t(
                            `${number(total - target)} ${label(metric.unit)} above target`,
                            `На ${number(total - target)} ${label(metric.unit)} выше цели`,
                          )
                        : total >= target
                          ? t("Target reached", "Цель достигнута")
                          : t(
                              `${number(target - total)} ${label(metric.unit)} to target`,
                              `До цели: ${number(target - total)} ${label(metric.unit)}`,
                            );
            return (
              <article
                key={metric.key}
                className={`goal-card ${over ? "goal-over" : ""} ${percent === null ? "goal-unknown" : ""}`}
              >
                <div className="goal-card-title">
                  <h3 aria-label={label(metric.label)}>
                    <button
                      className="goal-detail-button"
                      aria-label={t(
                        `Show ${metric.label.toLowerCase()} contributions`,
                        `Показать вклад: ${label(metric.label)}`,
                      )}
                      onClick={() =>
                        setDetail({ metric, total, target, known, partial })
                      }
                    >
                      {label(metric.label)}
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
                    / {number(target)} {label(metric.unit)}
                    {metric.kind === "limit"
                      ? t(" limit", " — ограничение")
                      : ""}
                  </span>
                </div>
                <progress
                  max="100"
                  value={percent === null ? 0 : Math.min(percent, 100)}
                  aria-label={`${label(metric.label)}: ${known ? `${t(`${number(total)} of ${number(target)}`, `${number(total)} из ${number(target)}`)} ${label(metric.unit)}, ${percent}%${partial ? t(", incomplete data", ", неполные данные") : ""}` : t("not tracked", "не отслеживается")}`}
                />
                <small>
                  {status}
                  {!single && known
                    ? t(` · ${known} known days`, ` · дней с данными: ${known}`)
                    : ""}
                </small>
              </article>
            );
          })}
      </div>
      {detail && (
        <Modal
          title={t(
            `${detail.metric.label}: where it comes from`,
            `${label(detail.metric.label)}: откуда берётся значение`,
          )}
          onClose={() => setDetail(null)}
        >
          <p className="goal-detail-total">
            <strong>
              {detail.known ? number(detail.total) : "—"}{" "}
              {label(detail.metric.unit)}
            </strong>{" "}
            / {number(detail.target)} {label(detail.metric.unit)}{" "}
            {detail.metric.kind === "limit"
              ? t("limit", "ограничение")
              : detail.metric.kind === "minimum"
                ? t("minimum", "минимум")
                : t("target", "цель")}
            {!single ? t(" per day", " в день") : ""}
          </p>
          <p>
            {detail.metric.kind === "limit"
              ? t(
                  "This is an upper limit. Amber means the recorded amount exceeds it.",
                  "Это верхняя граница. Янтарный цвет означает, что записанное количество выше неё.",
                )
              : detail.metric.kind === "minimum"
                ? t(
                    "This is a minimum goal. Going above it does not trigger an amber warning.",
                    "Это минимальная цель. Её превышение не вызывает янтарного предупреждения.",
                  )
                : t(
                    "This is a daily target. Amber means you are above it; it is a planning signal, not a safety limit.",
                    "Это цель на день. Янтарный цвет означает превышение: это ориентир для планирования, а не граница безопасности.",
                  )}
            {detail.metric.key === "saturatedFat" || detail.metric.key === "fat"
              ? t(
                  " Saturated fat is part of total fat, not an additional amount.",
                  " Насыщенные жиры входят в общее количество жиров, а не прибавляются к нему.",
                )
              : ""}
          </p>
          {!single && (
            <p>
              {detail.known
                ? t(
                    `Sum of recorded contributions ÷ ${detail.known} known days = the displayed daily average.`,
                    `Сумма записанных значений ÷ число дней с данными (${detail.known}) = среднее за день.`,
                  )
                : t(
                    "No known days in this interval.",
                    "Нет дней с известными значениями за этот период.",
                  )}{" "}
              {t(
                "Only logged days with fully known values for this nutrient are included.",
                "Учитываются дни с записями и полными данными по этому нутриенту.",
              )}
            </p>
          )}
          {detail.partial && (
            <p className="form-note">
              {t(
                "Some values are missing; unknown values are not zero. Multi-day averages exclude days missing this nutrient.",
                "Часть значений отсутствует; неизвестное не равно нулю. Средние за несколько дней исключают дни без данных по этому нутриенту.",
              )}
            </p>
          )}
          {
            <>
              <p>
                {t(
                  "Largest contributors first. Percentages show each entry’s share of the recorded total. Ingredient values already account for the amount eaten and any journal corrections.",
                  "Сначала показан наибольший вклад. Проценты — доля каждой записи в общей сумме. Значения ингредиентов уже учитывают съеденное количество и исправления в журнале.",
                )}
              </p>
              <ol className="goal-contributors">
                {stats.entries
                  .filter(
                    (e) =>
                      selectedDays.some((d) => d.date === e.date) &&
                      eligibleDay(e.date, detail.metric.key as keyof Nutrients),
                  )
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
                              ? t("Unknown", "Неизвестно")
                              : `${number(value)} ${label(detail.metric.unit)}`}
                          </strong>
                        </div>
                        <small>
                          {dateText(entry.date)} · {label(entry.meal)} ·{" "}
                          {number(entry.amount)} {label(entry.unit)}
                          {share !== null
                            ? t(
                                ` · ${number(share)}% of recorded total`,
                                ` · ${number(share)}% от записанной суммы`,
                              )
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
                              {item.name}:{" "}
                              {t(
                                `${number(item.grams)} g eaten`,
                                `Съедено ${number(item.grams)} г`,
                              )}{" "}
                              →{" "}
                              <strong>
                                {item.nutrients[
                                  detail.metric.key as keyof Nutrients
                                ] === undefined
                                  ? t("Unknown", "Неизвестно")
                                  : `${number(item.nutrients[detail.metric.key as keyof Nutrients]!)} ${label(detail.metric.unit)}`}
                              </strong>
                            </li>
                          ))}
                        </ul>
                      </li>
                    );
                  })}
              </ol>
              {!stats.entries.some(
                (e) =>
                  selectedDays.some((d) => d.date === e.date) &&
                  eligibleDay(e.date, detail.metric.key as keyof Nutrients),
              ) && (
                <p>
                  {t(
                    "No food entries contribute in this view.",
                    "В этом представлении нет записей о еде.",
                  )}
                </p>
              )}
            </>
          }
        </Modal>
      )}
      <button
        className="text-button"
        aria-expanded={expanded}
        aria-controls="goal-metrics"
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? t("Show less", "Свернуть") : t("Show more", "Показать ещё")}
      </button>
      {expanded && (
        <p className="goals-footnote">
          {t(
            "Missing values are unknown, not zero. Free sugars differ from total and added sugars.",
            "Отсутствующие значения неизвестны, а не равны нулю. Свободные сахара отличаются от общих и добавленных.",
          )}
        </p>
      )}
      {!single && (
        <section className="panel goals-trends">
          <h2>{t("Across days", "По дням")}</h2>
          <p>
            {t(
              "Select a day to review its journal.",
              "Выберите день, чтобы открыть журнал.",
            )}
          </p>
          <div className="goals-table-wrap">
            <table>
              <caption className="sr-only">
                {t("Daily nutrition", "Ежедневное питание")}
              </caption>
              <thead>
                <tr>
                  <th>{t("Day", "День")}</th>
                  <th>{t("Energy", "Калории")}</th>
                  <th>{t("Protein", "Белок")}</th>
                </tr>
              </thead>
              <tbody>
                {stats.days.map((day) => {
                  const kcal = day.nutrients.calories;
                  const goal = goalsOn(data, day.date).calories;
                  return (
                    <tr key={day.date}>
                      <th>
                        <button
                          className="text-button"
                          onClick={() => onDay(day.date)}
                        >
                          {dateText(day.date)}
                        </button>
                      </th>
                      <td>
                        {kcal === undefined || !day.count ? (
                          "—"
                        ) : (
                          <>
                            <span>
                              {number(kcal)} {label("kcal")} ·{" "}
                              {Math.round((kcal / goal) * 100)}%
                              {stats.entries
                                .filter((e) => e.date === day.date)
                                .some((e) =>
                                  e.items.some(
                                    (i) => i.nutrients.calories === undefined,
                                  ),
                                )
                                ? t(" · known only", " · только известное")
                                : ""}
                            </span>
                            <progress
                              aria-label={t(
                                `Energy on ${dateText(day.date)}`,
                                `Калории за ${dateText(day.date)}`,
                              )}
                              max={goal}
                              value={Math.min(kcal, goal)}
                            />
                          </>
                        )}
                      </td>
                      <td>
                        {day.nutrients.protein === undefined
                          ? "—"
                          : `${number(day.nutrients.protein)} ${label("g")}`}
                        {day.nutrients.protein !== undefined &&
                          stats.entries
                            .filter((e) => e.date === day.date)
                            .some((e) =>
                              e.items.some(
                                (i) => i.nutrients.protein === undefined,
                              ),
                            ) && (
                            <small>
                              {t(" · known only", " · только известное")}
                            </small>
                          )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}

export function GoalAdmin({ today }: { today: string }) {
  const { t, label, number, messageText } = useGoalText();
  const [settings, setSettings] = useState<GoalSettings | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [enrichment, setEnrichment] = useState<
    {
      name?: string;
      added?: string[];
      warning?: string;
      error?: string;
      empty?: boolean;
    }[]
  >([]);
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
      <h2>{t("Goals & baseline", "Цели и ориентиры")}</h2>
      <p>
        {t(
          "Your starting plan: 2,100 kcal, 160 g protein, 70 g fat and 208 g carbohydrates. Edit any target below. These are manually controlled starting targets, not automatic dietary advice.",
          "Стартовый план: 2 100 ккал, 160 г белка, 70 г жиров и 208 г углеводов. Измените цели ниже. Это начальные ориентиры с ручной настройкой, а не автоматические рекомендации по питанию.",
        )}
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
              setMessage(goalsSaved);
              window.dispatchEvent(new Event("ledger-goals-changed"));
            } catch (e) {
              setMessage(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            <span>{t("Apply starting on", "Применить с даты")}</span>
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
                  {label(metric.label)} ({label(metric.unit)}/
                  {label(metric.period)})
                  {metric.kind === "limit"
                    ? t(" · upper limit", " · верхняя граница")
                    : metric.kind === "minimum"
                      ? t(" · minimum", " · минимум")
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
                    {t("Starting guide:", "Начальный ориентир:")}{" "}
                    {number(metric.min)}–{number(metric.max)}{" "}
                    {label(metric.unit)}
                  </small>
                )}
              </label>
            ))}
          </div>
          <p>
            {t(
              "Calories from your macros ≈ protein × 4 + carbs × 4 + fat × 9. Changing a target does not automatically change the others.",
              "Калории из БЖУ ≈ белок × 4 + углеводы × 4 + жиры × 9. Изменение одной цели не меняет остальные автоматически.",
            )}
          </p>
          <button className="primary" disabled={busy}>
            {busy
              ? t("Saving…", "Сохранение…")
              : t("Save goals", "Сохранить цели")}
          </button>
        </form>
      )}
      {message && <p role="status">{messageText(message)}</p>}
      <div className="body-trend">
        <h3>{t("Saved food data", "Данные сохранённых продуктов")}</h3>
        <p>
          {t(
            "Fill missing nutrients from each food’s exact USDA or Open Food Facts record. Existing journal entries stay unchanged. Unsupported values remain unknown.",
            "Заполнить недостающие нутриенты из точной записи продукта в USDA или Open Food Facts. Существующие записи журнала не меняются. Недоступные значения остаются неизвестными.",
          )}
        </p>
        <button
          disabled={enriching}
          onClick={async () => {
            setEnriching(true);
            setEnrichment([]);
            try {
              const products = await action<Product[]>("list_products");
              if (!products.length) setEnrichment([{ empty: true }]);
              for (const product of products) {
                try {
                  const result = await action<{
                    added: string[];
                    warning?: string;
                  }>("save_enriched_product", { id: product.id });
                  setEnrichment((lines) => [
                    ...lines,
                    { name: product.name, ...result },
                  ]);
                } catch (e) {
                  setEnrichment((lines) => [
                    ...lines,
                    { name: product.name, error: errorText(e) },
                  ]);
                }
              }
            } catch (e) {
              setEnrichment([{ error: errorText(e) }]);
            } finally {
              setEnriching(false);
              window.dispatchEvent(new Event("ledger-foods-changed"));
            }
          }}
        >
          {enriching
            ? t("Refreshing foods…", "Обновление продуктов…")
            : t(
                "Refresh missing food nutrients",
                "Дополнить нутриенты продуктов",
              )}
        </button>
        <div role="status" aria-live="polite">
          {enrichment.length > 0 && (
            <ul>
              {enrichment.map((line, index) => (
                <li key={index}>
                  {line.name ? `${line.name}: ` : ""}
                  {line.empty
                    ? t(
                        "No saved foods to refresh.",
                        "Нет сохранённых продуктов для обновления.",
                      )
                    : line.error
                      ? messageText(line.error)
                      : line.added?.length
                        ? t(
                            `added ${line.added.map(label).join(", ")}`,
                            `добавлено: ${line.added.map(label).join(", ")}`,
                          )
                        : t(
                            "no additional values",
                            "нет дополнительных значений",
                          )}
                  {line.warning ? `. ${messageText(line.warning)}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
