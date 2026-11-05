import { useEffect, useState } from "react";
import { DateTime } from "luxon";
import { useI18n, localizeLabel, localizeError } from "./i18n.js";
import { action, nutrientLabels, type Stats, type Nutrients } from "./shared";
import { nutritionProgress } from "./progress-data.js";
import { ExportData } from "./ExportData.js";
import {
  defaultGoals,
  metricDefinitions,
  type GoalsData,
} from "./goals-shared";
import "./progress.css";

export const PROGRESS_START_DATE = "2026-09-24";
function useProgressFormat() {
  const { locale, language, t } = useI18n();
  return {
    t,
    locale,
    language,
    format: (value: number) =>
      new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value),
    label: (date: string) =>
      DateTime.fromISO(date)
        .setLocale(locale)
        .toLocaleString({ month: "short", day: "numeric" }),
  };
}
type Point = {
  date: string;
  value?: number;
  target?: number;
  partial?: boolean;
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
  const { t, format, label } = useProgressFormat();
  const values = points.flatMap((p) =>
    [p.value, p.target].filter((v): v is number => v !== undefined),
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
          aria-label={t(
            `${title}. Exact values and journal links are available in Show daily values.`,
            `${title}. Точные значения и ссылки на дневник доступны в разделе «Показать значения по дням».`,
          )}
        >
          <svg
            viewBox="0 0 510 210"
            role="img"
            aria-label={t(
              `${title}, ${label(points[0].date)} to ${label(points.at(-1)!.date)}. ${points.filter((p) => p.value !== undefined).length} recorded days.`,
              `${title}, с ${label(points[0].date)} по ${label(points.at(-1)!.date)}. Дней с записями: ${points.filter((p) => p.value !== undefined).length}.`,
            )}
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
                {(p.value !== undefined || bars) && (
                  <>
                    {!bars && i > 0 && points[i - 1].value !== undefined && (
                      <line
                        x1={x(i - 1)}
                        y1={y(points[i - 1].value!)}
                        x2={x(i)}
                        y2={y(p.value!)}
                        className="progress-line"
                      />
                    )}
                    {bars ? (
                      <rect
                        x={x(i) - Math.min(13, 170 / points.length)}
                        y={Math.min(y(p.value ?? 0), 172)}
                        width={Math.min(26, 340 / points.length)}
                        height={Math.max(2, 174 - y(p.value ?? 0))}
                        rx="3"
                        className={
                          p.value !== undefined && !p.partial
                            ? "progress-bar"
                            : "progress-bar progress-bar-partial"
                        }
                      >
                        <title>
                          {label(p.date)}: {format(p.value ?? 0)} {unit}
                          {p.value === undefined
                            ? t(
                                " · not recorded (display fallback)",
                                " · нет данных (ноль для отображения)",
                              )
                            : ""}
                          {p.partial
                            ? t(
                                " · incomplete nutrition",
                                " · неполные данные о питании",
                              )
                            : ""}
                        </title>
                      </rect>
                    ) : (
                      <circle
                        cx={x(i)}
                        cy={y(p.value!)}
                        r="4"
                        className="progress-dot"
                      >
                        <title>
                          {label(p.date)}: {format(p.value!)} {unit}
                        </title>
                      </circle>
                    )}
                  </>
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
          {t(
            `No ${title.toLowerCase()} recorded yet.`,
            `Пока нет записей: ${title.toLowerCase()}.`,
          )}
          <span>
            {t(
              "Open a day below to add your first record.",
              "Выберите день ниже, чтобы добавить первую запись.",
            )}
          </span>
        </div>
      )}
      <details className="progress-data">
        <summary>{t("Show daily values", "Показать значения по дням")}</summary>
        <div className="progress-table-wrap">
          <table>
            <caption>
              {title} · {unit}
            </caption>
            <thead>
              <tr>
                <th>{t("Day", "День")}</th>
                <th>{t("Recorded", "Записано")}</th>
                {points.some((p) => p.target !== undefined) && (
                  <th>{t("Goal / limit", "Цель / лимит")}</th>
                )}
                <th>{t("Status", "Статус")}</th>
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
                  <td>
                    {p.value === undefined
                      ? bars
                        ? "0*"
                        : "—"
                      : format(p.value)}
                  </td>
                  {points.some((d) => d.target !== undefined) && (
                    <td>{p.target === undefined ? "—" : format(p.target)}</td>
                  )}
                  <td>
                    {p.partial
                      ? t("Missing nutrition", "Неполные данные о питании")
                      : p.value === undefined
                        ? t("Not recorded", "Нет записи")
                        : t("Known nutrition", "Данные о питании полные")}
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
  const { t, locale, language, format, label } = useProgressFormat();
  const [windowDays, setWindowDays] = useState(30);
  const [customRange, setCustomRange] = useState({
    start: PROGRESS_START_DATE,
    end: today,
  });
  const [nutrient, setNutrient] = useState("protein");
  const [data, setData] = useState<{ stats: Stats; goals: GoalsData } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const start =
    windowDays === 0
      ? customRange.start
      : [
          PROGRESS_START_DATE,
          DateTime.fromISO(today)
            .minus({ days: windowDays - 1 })
            .toISODate()!,
        ]
          .sort()
          .at(-1)!;
  const end = windowDays === 0 ? customRange.end : today;
  const rangeError =
    !start || !end || start < PROGRESS_START_DATE || end > today || start > end
      ? t(
          "Choose dates from September 24, 2026 through today, with the end on or after the start.",
          "Выберите даты с 24 сентября 2026 года по сегодня. Конец периода должен быть не раньше начала.",
        )
      : DateTime.fromISO(end).diff(DateTime.fromISO(start), "days").days >= 366
        ? t(
            "Choose an interval of up to 366 days.",
            "Выберите период не более 366 дней.",
          )
        : "";
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    if (rangeError) return;
    Promise.all([
      action<Stats>("get_stats", { start, end }),
      action<GoalsData>("get_goals", { start, end }),
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
  }, [start, end, rangeError, revision, retry]);
  useEffect(() => {
    const refresh = () => setRetry((v) => v + 1);
    window.addEventListener("ledger-goals-changed", refresh);
    return () => window.removeEventListener("ledger-goals-changed", refresh);
  }, []);
  const toolbar = (
    <div className="progress-heading">
      <div>
        <p>
          {t(
            `Your trends begin ${label(PROGRESS_START_DATE)}. Every recorded day adds to the picture.`,
            `Динамика отслеживается с ${label(PROGRESS_START_DATE)}. Каждая запись дополняет картину.`,
          )}
        </p>
      </div>
      <div className="progress-period">
        <div
          className="progress-ranges"
          aria-label={t("Progress period", "Период прогресса")}
        >
          {[7, 30, 90].map((days) => (
            <button
              key={days}
              aria-pressed={days === windowDays}
              onClick={() => setWindowDays(days)}
            >
              {t(`${days} days`, `${days} дней`)}
            </button>
          ))}
          <button
            aria-pressed={windowDays === 0}
            onClick={() => {
              if (windowDays !== 0) setCustomRange({ start, end });
              setWindowDays(0);
            }}
          >
            {t("Custom", "Свой период")}
          </button>
        </div>
        {windowDays === 0 && (
          <div className="progress-dates">
            <label>
              {t("From", "С")}
              <input
                aria-label={t(
                  "Progress start date",
                  "Начальная дата прогресса",
                )}
                type="date"
                min={PROGRESS_START_DATE}
                max={today}
                value={customRange.start}
                onChange={(e) =>
                  setCustomRange({ ...customRange, start: e.target.value })
                }
              />
            </label>
            <label>
              {t("To", "По")}
              <input
                aria-label={t("Progress end date", "Конечная дата прогресса")}
                type="date"
                min={PROGRESS_START_DATE}
                max={today}
                value={customRange.end}
                onChange={(e) =>
                  setCustomRange({ ...customRange, end: e.target.value })
                }
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
  if (rangeError)
    return (
      <section className="progress-page">
        {toolbar}
        <p role="alert">{rangeError}</p>
      </section>
    );
  if (error)
    return (
      <section className="progress-page">
        {toolbar}
        <div className="panel">
          <p role="alert">{localizeError(error, language)}</p>
          <button onClick={() => setRetry((v) => v + 1)}>
            {t("Retry progress", "Загрузить снова")}
          </button>
        </div>
      </section>
    );
  if (!data)
    return (
      <section className="progress-page">
        {toolbar}
        <p role="status">{t("Loading progress…", "Загрузка прогресса…")}</p>
      </section>
    );
  const { stats, goals } = data;
  const days = stats.days;
  const targets = (date: string) =>
    [...goals.history]
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
      .find((g) => g.effectiveDate <= date)?.targets ?? defaultGoals;
  const nutrition = nutritionProgress(stats);
  const selectedNutrient = nutrition.available.includes(
    nutrient as keyof Nutrients,
  )
    ? (nutrient as keyof Nutrients)
    : nutrition.available[0];
  const foodPoints = (key: keyof Nutrients): Point[] =>
    nutrition.series[key].map((point) => ({
      ...point,
      target: targets(point.date)[key],
    }));
  const caloriePoints = foodPoints("calories");
  const nutrientPoints = selectedNutrient ? foodPoints(selectedNutrient) : [];
  const average = (points: Point[]) =>
    mean(
      points
        .filter((p) => !p.partial && p.value !== undefined)
        .map((p) => p.value!),
    );
  const knownCount = (points: Point[]) =>
    points.filter((p) => !p.partial && p.value !== undefined).length;
  const nutrientDef = metricDefinitions.find((m) => m.key === selectedNutrient);
  const nutrientName = (key: keyof Nutrients) =>
    nutrientLabels[key].split(" (")[0];
  const nutrientLabel = selectedNutrient
    ? localizeLabel(nutrientName(selectedNutrient), language)
    : "";
  const nutrientUnit = selectedNutrient
    ? localizeLabel(
        nutrientDef?.unit ??
          nutrientLabels[selectedNutrient].match(/\(([^)]+)\)/)![1],
        language,
      )
    : "";
  return (
    <section className="progress-page">
      {toolbar}
      <div className="progress-panels">
        <section className="panel">
          <div className="progress-panel-heading">
            <div>
              <span className="progress-eyebrow">
                {t("Your daily budget", "Ваш дневной бюджет")}
              </span>
              <h2>{t("Calories over days", "Калории по дням")}</h2>
            </div>
          </div>
          <div className="progress-big">
            {average(caloriePoints) === undefined
              ? "—"
              : format(average(caloriePoints)!)}
            <small>{t(" kcal / day", " ккал / день")}</small>
          </div>
          <p>
            {t(
              `Average from ${knownCount(caloriePoints)} logged days with known calories. Hollow bars indicate missing nutrition or no logs.`,
              `Среднее по дням с известной калорийностью: ${knownCount(caloriePoints)}. Контурные столбцы — неполные данные о питании или отсутствие записей.`,
            )}
          </p>
          <Chart
            title={t("Calories", "Калории")}
            unit={t("kcal", "ккал")}
            points={caloriePoints}
            bars
            onDay={onDay}
          />
          <div className="progress-legend">
            <span>
              <i />
              {t("Known nutrition", "Полные данные")}
            </span>
            <span>
              <i className="hollow" />
              {t("Missing / no data", "Неполные / нет данных")}
            </span>
            <span>
              <i className="dashed" />
              {t("Daily target", "Дневная цель")}
            </span>
          </div>
        </section>
        <section
          className="panel"
          aria-label={t("Nutrients over days", "Нутриенты по дням")}
        >
          <div className="progress-nutrient-heading">
            <div className="progress-panel-heading">
              <div>
                <span className="progress-eyebrow">
                  {t("Nutrition consistency", "Регулярность питания")}
                </span>
                <h2>{t("Nutrients over days", "Нутриенты по дням")}</h2>
              </div>
              {selectedNutrient && (
                <label className="progress-select">
                  <span className="sr-only">{t("Nutrient", "Нутриент")}</span>
                  <select
                    value={selectedNutrient}
                    onChange={(e) => setNutrient(e.target.value)}
                  >
                    {nutrition.available.map((key) => (
                      <option key={key} value={key}>
                        {localizeLabel(nutrientName(key), language)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div
              className="progress-ranges progress-nutrient-shortcuts"
              role="group"
              aria-label={t("Quick nutrients", "Основные нутриенты")}
            >
              {(["protein", "fat", "carbs", "fiber"] as const)
                .filter((key) => nutrition.available.includes(key))
                .map((key) => (
                  <button
                    key={key}
                    aria-pressed={selectedNutrient === key}
                    onClick={() => setNutrient(key)}
                  >
                    {localizeLabel(nutrientName(key), language)}
                  </button>
                ))}
            </div>
            {!nutrition.available.includes("fiber") && (
              <p className="progress-coverage">
                {t(
                  "Fiber charts appear when a logged food has a known fiber value.",
                  "График клетчатки появится, когда её значение будет известно хотя бы для одного записанного продукта.",
                )}
              </p>
            )}
          </div>
          {selectedNutrient ? (
            <>
              <div className="progress-big">
                {average(nutrientPoints) === undefined
                  ? "—"
                  : format(average(nutrientPoints)!)}
                <small>
                  {" "}
                  {nutrientUnit}
                  {t(" / day", " / день")}
                </small>
              </div>
              <p>
                {t(
                  `${nutrientPoints.filter((p) => p.value !== undefined && !p.partial).length} of ${nutrition.loggedDays} logged days have complete nutrient data. Outlined bars show known subtotals for incomplete days. Unknown values are not zero. `,
                  `Дней с полными данными о нутриенте: ${nutrientPoints.filter((p) => p.value !== undefined && !p.partial).length} из ${nutrition.loggedDays} дней с записями. Контурные столбцы показывают известные суммы за неполные дни. Неизвестные значения не равны нулю. `,
                )}
                {t(
                  `Average from ${knownCount(nutrientPoints)} logged days with fully known ${nutrientLabel.toLowerCase()}.`,
                  `Среднее по дням с полными данными (${nutrientLabel.toLowerCase()}): ${knownCount(nutrientPoints)}.`,
                )}
                {nutrientDef && (
                  <>
                    {" "}
                    {t("Dashed line: ", "Пунктир: ")}
                    {nutrientDef.kind === "limit"
                      ? t("upper limit", "верхний лимит")
                      : t("daily target", "дневная цель")}
                    .
                  </>
                )}
              </p>
              <Chart
                title={nutrientLabel}
                unit={nutrientUnit}
                points={nutrientPoints}
                bars
                onDay={onDay}
              />
            </>
          ) : (
            <p>
              {t(
                "No nutrient values recorded for the selected period. Add food nutrition to make charts available.",
                "Нет значений нутриентов за выбранный период. Добавьте данные о питании продуктов, чтобы появились графики.",
              )}
            </p>
          )}
        </section>
      </div>
      <p className="progress-footnote">
        {t(
          "Targets follow the settings effective on each day. 0* is a display fallback for missing nutrition, not a recorded zero. Nutrition averages use logged days with fully known values for each nutrient; they do not confirm that every meal was logged. Progress does not adjust your goals automatically.",
          "Цели соответствуют настройкам каждого дня. 0* — ноль для отображения пропущенных данных о питании, а не записанное значение. Средние учитывают дни с записями и полными данными по выбранному нутриенту; это не подтверждает, что записаны все приёмы пищи. Прогресс не изменяет ваши цели автоматически.",
        )}
      </p>
      <ExportData />
    </section>
  );
}
