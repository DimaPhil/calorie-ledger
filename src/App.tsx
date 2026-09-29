import {
  lazy,
  Suspense,
  useEffect,
  useState,
  useId,
  cloneElement,
  isValidElement,
  type ReactElement,
  type FormEvent,
  type ReactNode,
} from "react";
import { DateTime } from "luxon";
import { GoalsDashboard, GoalAdmin } from "./Goals.js";
import { Progress } from "./Progress.js";
import { Modal } from "./Modal.js";
import {
  useI18n,
  LanguageSwitcher,
  localizeLabel,
  localizeError,
} from "./i18n.js";
const Menu = lazy(() =>
  import("./Menu.js").then((module) => ({ default: module.Menu })),
);
import {
  action,
  api,
  nutrientKeys,
  nutrientLabels,
  units,
  type Product,
  type ProductInput,
  type Dish,
  type DishInput,
  type User,
  type Stats,
  type SearchResult,
  type Quantity,
  type Entry,
  type EntryUpdate,
  type Nutrients,
} from "./shared.js";

function useAppI18n() {
  const { t, language, locale } = useI18n();
  const num = (n?: number) =>
    n === undefined
      ? "—"
      : new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n);
  const label = (value: string) => localizeLabel(value, language);
  return { t, language, locale, num, label };
}
const blankProduct = (): ProductInput => ({
  name: "",
  brand: "",
  nutrients: {},
  portions: [],
  source: "custom",
  notes: "",
});
function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <label className="field">
      <span id={id}>{label}</span>
      {isValidElement(children)
        ? cloneElement(
            children as ReactElement<{ "aria-labelledby"?: string }>,
            { "aria-labelledby": id },
          )
        : children}
    </label>
  );
}
function Submit({ children, busy }: { children: ReactNode; busy?: boolean }) {
  const { t } = useAppI18n();
  return (
    <button className="primary" disabled={busy} type="submit">
      {busy ? t("Working…", "Сохранение…") : children}
    </button>
  );
}
function QuantityFields({
  value,
  onChange,
  product,
  dish = false,
}: {
  value: Quantity;
  onChange: (q: Quantity) => void;
  product?: Product;
  dish?: boolean;
}) {
  const { t, num, label } = useAppI18n();
  return (
    <div className="row">
      <Field label={t("Amount", "Количество")}>
        <input
          required
          type="number"
          min="0.001"
          step="any"
          value={value.amount}
          onChange={(e) =>
            onChange({ ...value, amount: Number(e.target.value) })
          }
        />
      </Field>
      <Field label={t("Unit", "Единица")}>
        <select
          value={value.unit}
          onChange={(e) =>
            onChange({
              amount: value.amount,
              unit: e.target.value as Quantity["unit"],
            })
          }
        >
          {(dish ? ["serving", "g", "oz", "kg", "lb"] : units).map((u) => (
            <option key={u} value={u}>
              {label(u === "fl_oz" ? "US fl oz" : u === "cup" ? "US cup" : u)}
            </option>
          ))}
        </select>
      </Field>
      {product && product.portions.some((p) => p.unit === value.unit) && (
        <Field label={t("Portion", "Порция")}>
          <select
            value={value.portionLabel || ""}
            onChange={(e) =>
              onChange({ ...value, portionLabel: e.target.value || undefined })
            }
          >
            <option value="">{t("Choose portion", "Выберите порцию")}</option>
            {product.portions
              .filter((p) => p.unit === value.unit)
              .map((p) => (
                <option key={p.label} value={p.label}>
                  {p.label} · {num(p.grams)}
                  {label("g")}
                </option>
              ))}
          </select>
        </Field>
      )}
    </div>
  );
}

export function App() {
  const { t } = useAppI18n();
  const [user, setUser] = useState<User | null>();
  useEffect(() => {
    api<User>("/api/me")
      .then(setUser)
      .catch(() => setUser(null));
  }, []);
  if (user === undefined)
    return (
      <main className="loading">
        {t("Opening your ledger…", "Открываем дневник…")}
      </main>
    );
  // Remount every account-owned view on login/logout, discarding cached data and
  // pending response handlers from the previous account.
  return (
    <SessionApp key={user?.id || "signed-out"} user={user} setUser={setUser} />
  );
}
function SessionApp({
  user,
  setUser,
}: {
  user: User | null;
  setUser: (user: User | null) => void;
}) {
  const { t, language, locale, num, label } = useAppI18n();
  const [tab, setTab] = useState("Journal");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<string | { perServing: Nutrients }>("");
  const noticeText =
    typeof notice === "string"
      ? localizeError(notice, language)
      : t(
          `Per serving: ${num(notice.perServing.calories)} kcal · Protein ${num(notice.perServing.protein)}g · Carbs ${num(notice.perServing.carbs)}g · Fat ${num(notice.perServing.fat)}g.`,
          `На порцию: ${num(notice.perServing.calories)} ккал · Белок ${num(notice.perServing.protein)} г · Углеводы ${num(notice.perServing.carbs)} г · Жиры ${num(notice.perServing.fat)} г.`,
        );
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [modal, setModal] = useState<null | "product" | "dish" | "log">(null);
  const [editProduct, setEditProduct] = useState<Product>();
  const [editDish, setEditDish] = useState<Dish>();
  const [logTarget, setLogTarget] = useState<Product | Dish>();
  const [query, setQuery] = useState("");
  const [searchResult, setSearchResult] = useState<SearchResult>();
  const [stats, setStats] = useState<Stats>();
  const [period, setPeriod] = useState("Day");
  const [dates, setDates] = useState({ start: "", end: "" });
  useEffect(() => {
    const refreshFoods = () => setRevision((n) => n + 1);
    window.addEventListener("ledger-foods-changed", refreshFoods);
    return () =>
      window.removeEventListener("ledger-foods-changed", refreshFoods);
  }, []);
  const today = () =>
    DateTime.now()
      .setZone(user?.timezone || "America/Los_Angeles")
      .toISODate()!;
  function selectPeriod(next: string, date = dates.start || today()) {
    setPeriod(next);
    if (next === "Custom") return;
    const anchor = DateTime.fromISO(date, { zone: user?.timezone });
    const unit = next === "Week" ? "week" : next === "Month" ? "month" : "day";
    setDates({
      start: anchor.startOf(unit).toISODate()!,
      end: anchor.endOf(unit).toISODate()!,
    });
  }
  function movePeriod(direction: number) {
    const unit =
      period === "Week" ? "weeks" : period === "Month" ? "months" : "days";
    selectPeriod(
      period,
      DateTime.fromISO(dates.start, { zone: user?.timezone })
        .plus({ [unit]: direction })
        .toISODate()!,
    );
  }
  const dateLabel =
    !dates.start || !dates.end
      ? t("Choose a date range", "Выберите период")
      : dates.start === dates.end
        ? `${dates.start === today() ? t("Today · ", "Сегодня · ") : dates.start === DateTime.fromISO(today()).minus({ days: 1 }).toISODate() ? t("Yesterday · ", "Вчера · ") : ""}${DateTime.fromISO(dates.start).setLocale(locale).toLocaleString(DateTime.DATE_FULL)}`
        : `${DateTime.fromISO(dates.start).setLocale(locale).toLocaleString(DateTime.DATE_MED)} – ${DateTime.fromISO(dates.end).setLocale(locale).toLocaleString(DateTime.DATE_MED)}`;
  const fail = (e: unknown) =>
    setError(
      e instanceof Error
        ? e.message
        : "Could not complete the request. Try again.",
    );
  async function perform(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!user) return;
    let active = true;
    Promise.all([
      action<Product[]>("list_products"),
      action<Dish[]>("list_dishes"),
    ])
      .then(([p, d]) => {
        if (!active) return;
        setProducts(p);
        setDishes(d);
      })
      .catch((e) => {
        if (active) fail(e);
      });
    return () => {
      active = false;
    };
  }, [user, revision]);
  useEffect(() => {
    if (!user) return;
    const now = DateTime.now().setZone(user.timezone);
    setPeriod("Day");
    setDates({ start: now.toISODate()!, end: now.toISODate()! });
  }, [user]);
  useEffect(() => {
    setStats(undefined);
    if (!user || !dates.start || !dates.end) return;
    setError("");
    let active = true;
    action<Stats>("get_stats", dates)
      .then((s) => {
        if (active) setStats(s);
      })
      .catch((e) => {
        if (active) fail(e);
      });
    return () => {
      active = false;
    };
  }, [user, dates, revision]);
  function done(message: string) {
    setModal(null);
    setRevision((n) => n + 1);
    setNotice(message);
  }
  function openProduct(p?: Product) {
    setEditProduct(p);
    setModal("product");
    setError("");
  }
  function openDish(d?: Dish) {
    setEditDish(d);
    setModal("dish");
    setError("");
  }
  function openLog(target?: Product | Dish) {
    setLogTarget(target);
    setModal("log");
    setError("");
  }
  if (user === undefined)
    return (
      <main className="loading">
        {t("Opening your ledger…", "Открываем дневник…")}
      </main>
    );
  if (!user)
    return (
      <main className="login">
        <LanguageSwitcher />
        <div className="login-story">
          <a className="brand" href="/">
            ◒ Calorie Ledger
          </a>
          <span className="eyebrow">
            {t(
              "A LITTLE MORE AWARE, EVERY DAY",
              "БОЛЬШЕ ОСОЗНАННОСТИ КАЖДЫЙ ДЕНЬ",
            )}
          </span>
          <h1>
            {t("Good food.", "Хорошая еда.")}
            <br />
            {t("A clear picture.", "Полная картина.")}
          </h1>
          <p>
            {t(
              "Your everyday meals, saved favorites, and a little help from your agent. One quiet place to keep track.",
              "Ежедневное питание, любимые продукты и помощь агента. Всё для учёта в одном месте.",
            )}
          </p>
          <div className="food-art" aria-hidden="true">
            <span>◒</span>
            <i>✳</i>
            <b>◔</b>
          </div>
        </div>
        <form
          className="login-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void perform(async () =>
              setUser(await api<User>("/api/login", Object.fromEntries(f))),
            );
          }}
        >
          <span className="eyebrow">
            {t("YOUR PERSONAL FOOD JOURNAL", "ВАШ ЛИЧНЫЙ ДНЕВНИК ПИТАНИЯ")}
          </span>
          <h2>{t("Welcome back", "С возвращением")}</h2>
          <p>
            {t("Sign in to your private ledger.", "Войдите в личный дневник.")}
          </p>
          <Field label={t("Username", "Имя пользователя")}>
            <input name="username" autoComplete="username" required autoFocus />
          </Field>
          <Field label={t("Password", "Пароль")}>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          {error && (
            <p className="error" role="alert">
              {localizeError(error, language)}
            </p>
          )}
          <Submit busy={busy}>{t("Sign in →", "Войти →")}</Submit>
          <small>
            {t(
              "Private by default. Accounts are invitation-only.",
              "Ваши данные приватны. Регистрация по приглашению.",
            )}
          </small>
        </form>
      </main>
    );
  return (
    <div className="shell">
      <aside
        className="sidebar"
        aria-label={t("Account navigation", "Навигация аккаунта")}
      >
        <a className="brand" href="/">
          ◒{" "}
          <span>
            Calorie
            <br />
            Ledger
          </span>
        </a>
        <LanguageSwitcher />
        <nav aria-label={t("Main navigation", "Основная навигация")}>
          {[
            ["Journal", "◷"],
            ["Progress", "↗"],
            ["Foods", "◈"],
            ["Dishes", "▤"],
            ["Menu", "☷"],
            ["Settings", "⚙"],
          ].map(([tabName, icon]) => (
            <button
              key={tabName}
              aria-current={tab === tabName ? "page" : undefined}
              className={tab === tabName ? "selected" : ""}
              onClick={() => {
                setTab(tabName);
                setError("");
                setNotice("");
              }}
            >
              <span aria-hidden="true">{icon}</span>
              {label(tabName)}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="avatar">
            {user.username.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{user.username}</strong>
            <small>{t("Your private space", "Ваше личное пространство")}</small>
          </div>
          <button
            aria-label={t("Sign out", "Выйти")}
            title={t("Sign out", "Выйти")}
            onClick={() =>
              void perform(async () => {
                await api("/api/logout", {});
                setUser(null);
              })
            }
          >
            ↗
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="page-header">
          <div>
            <span className="eyebrow">
              {tab === "Journal"
                ? t("YOUR FOOD JOURNAL", "ВАШ ДНЕВНИК ПИТАНИЯ")
                : tab === "Progress"
                  ? t("THE BIGGER PICTURE", "ОБЩАЯ КАРТИНА")
                  : tab === "Menu"
                    ? t("YOUR RECIPE LIBRARY", "ВАША КОЛЛЕКЦИЯ РЕЦЕПТОВ")
                    : t("YOUR EVERYDAY ESSENTIALS", "ПРОДУКТЫ НА КАЖДЫЙ ДЕНЬ")}
            </span>
            <h1>
              {tab === "Journal"
                ? t("Your day, on the record.", "Ваш день в деталях.")
                : tab === "Progress"
                  ? t("See your progress.", "Следите за прогрессом.")
                  : tab === "Menu"
                    ? t("Good food, within reach.", "Хорошая еда — это просто.")
                    : tab === "Foods"
                      ? t("Foods you know.", "Знакомые продукты.")
                      : tab === "Dishes"
                        ? t(
                            "Make it once. Save it here.",
                            "Создайте рецепт. Сохраните здесь.",
                          )
                        : t("Make yourself at home.", "Настройте под себя.")}
            </h1>
            <p>
              {tab === "Journal"
                ? t(
                    "A little attention goes a long way.",
                    "Немного внимания — заметный результат.",
                  )
                : tab === "Progress"
                  ? t(
                      "Your nutrition and daily check-ins, over time.",
                      "Питание и ежедневные отметки в динамике.",
                    )
                  : tab === "Menu"
                    ? t(
                        "A collection of quick recipes to come back to.",
                        "Коллекция быстрых рецептов на каждый день.",
                      )
                    : tab === "Foods"
                      ? t(
                          "Find a product, check its label, and make it a regular.",
                          "Найдите продукт, проверьте этикетку и сохраните.",
                        )
                      : tab === "Dishes"
                        ? t(
                            "Flexible recipes for the meals you come back to.",
                            "Гибкие рецепты для любимых блюд.",
                          )
                        : t(
                            "Your preferences, security, and agent connection.",
                            "Настройки, безопасность и подключение агента.",
                          )}
            </p>
          </div>
          {tab === "Journal" ? (
            <button className="primary" onClick={() => openLog()}>
              {t("＋ Log food", "＋ Записать еду")}
            </button>
          ) : tab === "Foods" ? (
            <button className="primary" onClick={() => openProduct()}>
              {t("＋ Custom food", "＋ Свой продукт")}
            </button>
          ) : tab === "Dishes" ? (
            <button className="primary" onClick={() => openDish()}>
              {t("＋ New dish", "＋ Новое блюдо")}
            </button>
          ) : null}
        </header>
        {error && (
          <div className="error" role="alert">
            {localizeError(error, language)}
            <button
              aria-label={t("Dismiss error", "Закрыть ошибку")}
              onClick={() => setError("")}
            >
              ×
            </button>
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            {noticeText}
          </div>
        )}
        {tab === "Journal" && (
          <>
            <div className="period-row">
              <div
                className="segmented"
                aria-label={t("Journal period", "Период дневника")}
              >
                {["Day", "Week", "Month", "Custom"].map((p) => (
                  <button
                    aria-pressed={period === p}
                    className={period === p ? "active" : ""}
                    key={p}
                    onClick={() => selectPeriod(p)}
                  >
                    {label(p)}
                  </button>
                ))}
              </div>
              <div className="date-range">
                {period === "Custom" ? (
                  <>
                    <Field label={t("From", "С")}>
                      <input
                        aria-label={t("From date", "Начало периода")}
                        type="date"
                        value={dates.start}
                        onChange={(e) =>
                          setDates({ ...dates, start: e.target.value })
                        }
                      />
                    </Field>
                    <Field label={t("Through", "По")}>
                      <input
                        aria-label={t("Through date", "Конец периода")}
                        type="date"
                        value={dates.end}
                        onChange={(e) =>
                          setDates({ ...dates, end: e.target.value })
                        }
                      />
                    </Field>
                  </>
                ) : (
                  <div className="date-navigation">
                    <button
                      aria-label={t(
                        `Previous ${period.toLowerCase()}`,
                        `Предыдущий период: ${label(period)}`,
                      )}
                      onClick={() => movePeriod(-1)}
                    >
                      ‹
                    </button>
                    <input
                      aria-label={t("Journal date", "Дата дневника")}
                      type="date"
                      value={dates.start}
                      onChange={(e) => {
                        if (e.target.value)
                          selectPeriod(period, e.target.value);
                      }}
                    />
                    <button
                      aria-label={t(
                        `Next ${period.toLowerCase()}`,
                        `Следующий период: ${label(period)}`,
                      )}
                      onClick={() => movePeriod(1)}
                    >
                      ›
                    </button>
                  </div>
                )}
                <button
                  className="today-shortcut"
                  onClick={() => selectPeriod("Day", today())}
                >
                  {t("Today", "Сегодня")}
                </button>
              </div>
            </div>
            <p className="journal-date-label" aria-live="polite">
              {dateLabel}
              {period === "Week" ? t(" · Mon–Sun", " · пн–вс") : ""}
            </p>
            {stats && (
              <GoalsDashboard
                stats={stats}
                today={today()}
                revision={revision}
                onDay={(date) => selectPeriod("Day", date)}
              />
            )}
            {stats &&
              stats.missingNutrients.some((k) =>
                ["calories", "protein", "carbs", "fat"].includes(k),
              ) && (
                <p className="hint">
                  {t(
                    "Some labels are incomplete. Totals include known values only; missing values are never treated as zero.",
                    "Некоторые этикетки неполные. Итоги включают только известные значения; пропуски не считаются нулями.",
                  )}
                </p>
              )}
            <div className="journal-grid">
              <section className="panel">
                <div className="section-heading">
                  <h2>
                    {period === "Day"
                      ? t("On the menu", "Что съедено")
                      : t("Food journal", "Дневник питания")}
                  </h2>
                  <span className="tag">
                    {t(
                      `${stats?.entries.length || 0} entries`,
                      `Записей: ${stats?.entries.length || 0}`,
                    )}
                  </span>
                </div>
                {!stats ? (
                  <p>{t("Loading your journal…", "Загружаем дневник…")}</p>
                ) : stats.entries.length === 0 ? (
                  <div className="empty">
                    <div className="empty-symbol">◷</div>
                    <h3>{t("A fresh page.", "Чистая страница.")}</h3>
                    <p>
                      {t(
                        "Breakfast, a snack, or last night’s dinner.",
                        "Завтрак, перекус или вчерашний ужин.",
                      )}
                      <br />
                      {t(
                        "Start with whatever’s on your mind.",
                        "Начните с любого приёма пищи.",
                      )}
                    </p>
                    <button className="primary" onClick={() => openLog()}>
                      {t("Log your first food", "Записать первую еду")}
                    </button>
                  </div>
                ) : (
                  <div className="entries">
                    {stats.entries.map((entry) => (
                      <EntryRow
                        key={entry.id}
                        entry={entry}
                        onDelete={async () => {
                          await action("delete_entry", { id: entry.id });
                          done("Entry deleted.");
                        }}
                        onEdit={async (changes) => {
                          const updated = await action<Entry>(
                            "update_entry",
                            changes,
                          );
                          done("Entry updated.");
                          return updated;
                        }}
                      />
                    ))}
                  </div>
                )}
              </section>
              <aside
                className="right-column"
                aria-label={t(
                  "Nutrition details and agent connection",
                  "Нутриенты и подключение агента",
                )}
              >
                <section className="panel soft">
                  <span className="eyebrow">
                    {t(
                      "SMALL DETAILS, BIG PICTURE",
                      "ДЕТАЛИ СКЛАДЫВАЮТСЯ В КАРТИНУ",
                    )}
                  </span>
                  <h2>{t("Beyond calories", "Не только калории")}</h2>
                  <dl className="nutrient-list">
                    {(
                      ["sugar", "fiber", "saturatedFat", "sodium"] as const
                    ).map((k) => (
                      <div key={k}>
                        <dt>{label(nutrientLabels[k]).split(" (")[0]}</dt>
                        <dd>
                          {num(stats?.totals[k])}{" "}
                          <small>{label(k === "sodium" ? "mg" : "g")}</small>
                          {stats?.missingNutrients.includes(k) ? " *" : ""}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <small>
                    {t(
                      "* Incomplete labels. — means unknown or no data.",
                      "* Неполные этикетки. — означает, что данных нет.",
                    )}
                  </small>
                  <details>
                    <summary>{t("All nutrients", "Все нутриенты")}</summary>
                    <dl className="nutrient-list">
                      {nutrientKeys.map((k) => (
                        <div key={k}>
                          <dt>{label(nutrientLabels[k])}</dt>
                          <dd>
                            {num(stats?.totals[k])}
                            {stats?.missingNutrients.includes(k) ? " *" : ""}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                </section>
                <section className="agent-card">
                  <span>✳</span>
                  <h3>
                    {t("A little help, on hand.", "Помощь всегда рядом.")}
                  </h3>
                  <p>
                    {t(
                      "Tell your agent what you ate. It can find your favorites and take care of the numbers.",
                      "Расскажите агенту, что съели. Он найдёт любимые продукты и посчитает всё за вас.",
                    )}
                  </p>
                  <button
                    className="text-button"
                    onClick={() => setTab("Settings")}
                  >
                    {t("Connect your agent ↗", "Подключить агента ↗")}
                  </button>
                </section>
              </aside>
            </div>
          </>
        )}
        {tab === "Progress" && (
          <Progress
            today={today()}
            revision={revision}
            onDay={(date) => {
              selectPeriod("Day", date);
              setTab("Journal");
            }}
          />
        )}
        {tab === "Menu" && (
          <Suspense
            fallback={
              <p role="status">{t("Loading menu…", "Загружаем меню…")}</p>
            }
          >
            <Menu userId={user.id} />
          </Suspense>
        )}
        {tab === "Foods" && (
          <>
            <form
              className="searchbar"
              onSubmit={(e) => {
                e.preventDefault();
                void perform(async () =>
                  setSearchResult(
                    await action<SearchResult>("search_products", { query }),
                  ),
                );
              }}
            >
              <label className="sr-only" htmlFor="food-search">
                {t("Search products", "Поиск продуктов")}
              </label>
              <input
                id="food-search"
                placeholder={t(
                  "Try a food, brand, or barcode…",
                  "Название, бренд или штрихкод…",
                )}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                required
              />
              <Submit busy={busy}>{t("Search foods", "Найти продукты")}</Submit>
            </form>
            {searchResult && (
              <section className="panel search-results">
                <div className="section-heading">
                  <h2>{t("Search results", "Результаты поиска")}</h2>
                  <button onClick={() => setSearchResult(undefined)}>
                    {t("Clear", "Очистить")}
                  </button>
                </div>
                <p>{localizeError(searchResult.reason, language)}</p>
                {searchResult.status === "matched" && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(async () =>
                        setSearchResult(
                          await action<SearchResult>("search_products", {
                            query: searchResult.query,
                            broaden: true,
                          }),
                        ),
                      )
                    }
                  >
                    {t("Search for other matches", "Найти другие варианты")}
                  </button>
                )}
                {searchResult.warnings.map((w) => (
                  <p className="hint" key={w}>
                    {localizeError(w, language)}
                  </p>
                ))}
                {searchResult.candidates.map((p) => (
                  <div className="food-row" key={p.id}>
                    <div>
                      <strong>{p.name}</strong>
                      {p.id === searchResult.preferredProductId && (
                        <small>
                          {t(
                            "Preferred saved food",
                            "Предпочтительный сохранённый продукт",
                          )}
                        </small>
                      )}
                      <small>
                        {p.brand || t("Unbranded", "Без бренда")} ·{" "}
                        {num(p.nutrients.calories)}{" "}
                        {t("kcal / 100g", "ккал / 100 г")} · {p.source}
                      </small>
                    </div>
                    <button
                      onClick={() =>
                        void perform(async () => {
                          let saved = products.find((x) => x.id === p.id);
                          if (!saved) {
                            const { id: _id, updatedAt: _date, ...data } = p;
                            saved = await action<Product>("save_product", {
                              product: data,
                            });
                          }
                          await action("remember_choice", {
                            query: searchResult.query,
                            productId: saved.id,
                          });
                          setRevision((n) => n + 1);
                          setSearchResult(undefined);
                          openProduct(saved);
                        })
                      }
                    >
                      {t("Choose & review", "Выбрать и проверить")}
                    </button>
                  </div>
                ))}
              </section>
            )}
            <div className="section-heading">
              <h2>{t("Your saved foods", "Сохранённые продукты")}</h2>
              <span>
                {t(
                  `${products.length} products`,
                  `Продуктов: ${products.length}`,
                )}
              </span>
            </div>
            <div className="cards">
              {products.map((p) => (
                <article className="panel food-card" key={p.id}>
                  <span className="tag">
                    {p.source === "custom"
                      ? t("YOUR LABEL", "ВАША ЭТИКЕТКА")
                      : p.source.toUpperCase()}
                  </span>
                  <h3>{p.name}</h3>
                  <p>{p.brand || t("Unbranded", "Без бренда")}</p>
                  <strong>
                    {num(p.nutrients.calories)}{" "}
                    <small>{t("kcal / 100g", "ккал / 100 г")}</small>
                  </strong>
                  <div className="mini-macros">
                    <span>
                      {t("P", "Б")} {num(p.nutrients.protein)}
                      {label("g")}
                    </span>
                    <span>
                      {t("C", "У")} {num(p.nutrients.carbs)}
                      {label("g")}
                    </span>
                    <span>
                      {t("F", "Ж")} {num(p.nutrients.fat)}
                      {label("g")}
                    </span>
                  </div>
                  <div className="card-actions">
                    <button className="primary" onClick={() => openLog(p)}>
                      {t("Log food", "Записать еду")}
                    </button>
                    <button onClick={() => openProduct(p)}>
                      {t("Edit", "Изменить")}
                    </button>
                    <button
                      aria-label={t(`Delete ${p.name}`, `Удалить ${p.name}`)}
                      onClick={() => {
                        if (
                          confirm(
                            t(
                              `Delete ${p.name}? Past logs are kept.`,
                              `Удалить ${p.name}? Прошлые записи сохранятся.`,
                            ),
                          )
                        )
                          void perform(async () => {
                            await action("delete_product", { id: p.id });
                            done("Product deleted.");
                          });
                      }}
                    >
                      ×
                    </button>
                  </div>
                </article>
              ))}
            </div>
            {products.length === 0 && (
              <div className="empty panel">
                <h3>
                  {t(
                    "Your favorites belong here.",
                    "Место для любимых продуктов.",
                  )}
                </h3>
                <p>
                  {t(
                    "Search US products above, or add a food from its nutrition label.",
                    "Найдите продукт в базах США или добавьте его по этикетке.",
                  )}
                </p>
                <button onClick={() => openProduct()}>
                  {t("Add custom food", "Добавить свой продукт")}
                </button>
              </div>
            )}
            <p className="attribution">
              {t("Product data from", "Данные о продуктах:")}{" "}
              <a
                href="https://fdc.nal.usda.gov"
                target="_blank"
                rel="noreferrer"
              >
                USDA FoodData Central
              </a>{" "}
              {t("and", "и")}{" "}
              <a
                href="https://world.openfoodfacts.org"
                target="_blank"
                rel="noreferrer"
              >
                Open Food Facts
              </a>{" "}
              ·{" "}
              <a
                href="https://opendatacommons.org/licenses/odbl/1-0/"
                target="_blank"
                rel="noreferrer"
              >
                ODbL
              </a>
              {t(
                ". Verify imported values against the label.",
                ". Проверяйте импортированные значения по этикетке.",
              )}
            </p>
          </>
        )}
        {tab === "Dishes" && (
          <>
            <div className="cards">
              {dishes.map((d) => (
                <article className="panel food-card" key={d.id}>
                  <span className="tag">{t("YOUR RECIPE", "ВАШ РЕЦЕПТ")}</span>
                  <h3>{d.name}</h3>
                  <p>
                    {t(
                      `${d.ingredients.length} ingredients · ${num(d.servings)} servings`,
                      `Ингредиентов: ${d.ingredients.length} · Порций: ${num(d.servings)}`,
                    )}
                  </p>
                  <p className="muted">
                    {d.notes ||
                      t(
                        "Adjust ingredients for each meal without changing your recipe.",
                        "Меняйте ингредиенты для отдельного приёма пищи, сохраняя рецепт.",
                      )}
                  </p>
                  <div className="card-actions">
                    <button className="primary" onClick={() => openLog(d)}>
                      {t("Log dish", "Записать блюдо")}
                    </button>
                    <button onClick={() => openDish(d)}>
                      {t("Edit", "Изменить")}
                    </button>
                    <button
                      aria-label={t(`Delete ${d.name}`, `Удалить ${d.name}`)}
                      onClick={() => {
                        if (
                          confirm(
                            t(
                              `Delete ${d.name}? Past logs are kept.`,
                              `Удалить ${d.name}? Прошлые записи сохранятся.`,
                            ),
                          )
                        )
                          void perform(async () => {
                            await action("delete_dish", { id: d.id });
                            done("Dish deleted.");
                          });
                      }}
                    >
                      ×
                    </button>
                  </div>
                </article>
              ))}
            </div>
            {dishes.length === 0 && (
              <div className="empty panel">
                <div className="empty-symbol">▤</div>
                <h3>
                  {t(
                    "Your go-to meal, ready to go.",
                    "Любимое блюдо всегда под рукой.",
                  )}
                </h3>
                <p>
                  {t(
                    "Combine saved foods, set the recipe yield, and let us do the math.",
                    "Объедините сохранённые продукты, задайте число порций — мы всё посчитаем.",
                  )}
                </p>
                <button className="primary" onClick={() => openDish()}>
                  {t("Create a dish", "Создать блюдо")}
                </button>
              </div>
            )}
          </>
        )}
        {tab === "Settings" && (
          <>
            <GoalAdmin today={today()} />
            <Settings
              user={user}
              setUser={setUser}
              perform={perform}
              busy={busy}
              notify={setNotice}
            />
          </>
        )}
      </main>
      {modal && (
        <Modal
          title={
            modal === "product"
              ? editProduct
                ? t("Edit food", "Изменить продукт")
                : t("Add a custom food", "Добавить свой продукт")
              : modal === "dish"
                ? editDish
                  ? t("Edit dish", "Изменить блюдо")
                  : t("Create a dish", "Создать блюдо")
                : t("Log something good", "Записать еду")
          }
          onClose={() => {
            if (!busy) {
              setModal(null);
              setError("");
            }
          }}
        >
          <p className="error" role="alert" hidden={!error}>
            {localizeError(error, language)}
          </p>
          {notice && (
            <p className="notice" role="status">
              {noticeText}
            </p>
          )}
          {modal === "product" && (
            <ProductForm
              product={editProduct}
              busy={busy}
              onSave={(p) =>
                void perform(async () => {
                  await action("save_product", {
                    id: editProduct?.id,
                    product: p,
                  });
                  done("Food saved to your collection.");
                })
              }
            />
          )}{" "}
          {modal === "dish" && (
            <DishForm
              dish={editDish}
              products={products}
              busy={busy}
              onSave={(d) =>
                void perform(async () => {
                  await action("save_dish", { id: editDish?.id, dish: d });
                  done("Dish saved.");
                })
              }
              onPreview={(d) =>
                void perform(async () => {
                  const result = await action<{
                    perServing: Nutrients;
                  }>("preview_dish", { dish: d });
                  setNotice({ perServing: result.perServing });
                })
              }
            />
          )}{" "}
          {modal === "log" && (
            <LogForm
              products={products}
              dishes={dishes}
              target={logTarget}
              defaultDate={
                tab === "Journal" && dates.start === dates.end
                  ? dates.start
                  : today()
              }
              defaultUnit={user.unitSystem === "us" ? "oz" : "g"}
              busy={busy}
              onSave={(input) =>
                void perform(async () => {
                  await action("log_food", input);
                  done("Logged. You’re all set.");
                })
              }
            />
          )}
        </Modal>
      )}
    </div>
  );
}

function ProductForm({
  product,
  busy,
  onSave,
}: {
  product?: Product;
  busy: boolean;
  onSave: (p: ProductInput) => void;
}) {
  const { t, label } = useAppI18n();
  const [draft, setDraft] = useState<ProductInput>(() =>
    product
      ? (({ id: _id, updatedAt: _at, ...rest }) => rest)(product)
      : blankProduct(),
  );
  const [basis, setBasis] = useState(100);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          ...draft,
          nutrients: Object.fromEntries(
            Object.entries(draft.nutrients).map(([k, v]) => [
              k,
              (v! * 100) / basis,
            ]),
          ),
        });
      }}
    >
      {product && (
        <p className="form-note">
          {t(
            "Saving corrections recalculates linked journal entries, including dishes using this food. Older entries and manual overrides stay fixed.",
            "Изменения пересчитают связанные записи дневника, включая блюда с этим продуктом. Старые записи и ручные корректировки сохранятся.",
          )}
        </p>
      )}
      <div className="row">
        <Field label={t("Food name", "Название продукта")}>
          <input
            autoFocus
            required
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </Field>
        <Field label={t("Brand", "Бренд")}>
          <input
            value={draft.brand}
            onChange={(e) => setDraft({ ...draft, brand: e.target.value })}
          />
        </Field>
      </div>
      <Field label={t("Barcode (optional)", "Штрихкод (необязательно)")}>
        <input
          value={draft.barcode || ""}
          onChange={(e) => setDraft({ ...draft, barcode: e.target.value })}
        />
      </Field>
      <div className="form-note">
        <strong>
          {t("Copy what’s on the label.", "Перепишите данные с этикетки.")}
        </strong>
        <p>
          {t(
            "Enter the values for the weight below. We’ll convert them to 100g. Leave unknown nutrients blank.",
            "Введите значения для указанного ниже веса. Мы пересчитаем на 100 г. Неизвестные значения оставьте пустыми.",
          )}
        </p>
        <Field
          label={t(
            "Label values are for this many grams",
            "Вес порции на этикетке, г",
          )}
        >
          <input
            required
            type="number"
            min="0.01"
            step="any"
            value={basis}
            onChange={(e) => setBasis(Number(e.target.value))}
          />
        </Field>
      </div>
      <div className="nutrient-fields">
        {nutrientKeys.map((k) => (
          <Field label={label(nutrientLabels[k])} key={k}>
            <input
              type="number"
              required={k === "calories"}
              min="0"
              step="any"
              value={draft.nutrients[k] ?? ""}
              onChange={(e) => {
                const nutrients = { ...draft.nutrients };
                if (e.target.value === "") delete nutrients[k];
                else nutrients[k] = Number(e.target.value);
                setDraft({ ...draft, nutrients });
              }}
            />
          </Field>
        ))}
      </div>
      <h3>{t("Saved portions", "Сохранённые порции")}</h3>
      <p className="muted">
        {t(
          "Grams in one serving, piece, or US measure. A “medium apple” can be an approximate portion; use its real weight when convenient.",
          "Вес одной порции, штуки или американской меры в граммах. «Среднее яблоко» — приблизительная порция; по возможности указывайте фактический вес.",
        )}
      </p>
      {draft.portions.map((p, i) => (
        <div className="portion-row" key={i}>
          <Field label={t("Portion label", "Название порции")}>
            <input
              required
              value={p.label}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  portions: draft.portions.map((v, n) =>
                    n === i ? { ...v, label: e.target.value } : v,
                  ),
                })
              }
            />
          </Field>
          <Field label={t("Portion unit", "Единица порции")}>
            <select
              value={p.unit}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  portions: draft.portions.map((v, n) =>
                    n === i
                      ? { ...v, unit: e.target.value as Quantity["unit"] }
                      : v,
                  ),
                })
              }
            >
              {units
                .filter((u) => !["g", "kg", "oz", "lb"].includes(u))
                .map((u) => (
                  <option key={u} value={u}>
                    {label(u)}
                  </option>
                ))}
            </select>
          </Field>
          <Field label={t("Grams per unit", "Граммов в единице")}>
            <input
              required
              type="number"
              min="0.01"
              step="any"
              value={p.grams}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  portions: draft.portions.map((v, n) =>
                    n === i ? { ...v, grams: Number(e.target.value) } : v,
                  ),
                })
              }
            />
          </Field>
          <button
            type="button"
            aria-label={t("Remove portion", "Удалить порцию")}
            onClick={() =>
              setDraft({
                ...draft,
                portions: draft.portions.filter((_, n) => n !== i),
              })
            }
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          setDraft({
            ...draft,
            portions: [
              ...draft.portions,
              { label: "", unit: "serving", grams: 100 },
            ],
          })
        }
      >
        {t("＋ Add portion", "＋ Добавить порцию")}
      </button>
      <Field label={t("Notes", "Заметки")}>
        <textarea
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
      </Field>
      <footer className="form-footer">
        <Submit busy={busy}>{t("Save food", "Сохранить продукт")}</Submit>
      </footer>
    </form>
  );
}

function IngredientFields({
  ingredients,
  products,
  onChange,
}: {
  ingredients: DishInput["ingredients"];
  products: Product[];
  onChange: (items: DishInput["ingredients"]) => void;
}) {
  const { t, label } = useAppI18n();
  return (
    <>
      {ingredients.map((i, index) => (
        <div className="ingredient" key={index}>
          <div className="row">
            <Field
              label={t(`Ingredient ${index + 1}`, `Ингредиент ${index + 1}`)}
            >
              <select
                required
                value={i.productId}
                onChange={(e) =>
                  onChange(
                    ingredients.map((v, n) =>
                      n === index ? { ...v, productId: e.target.value } : v,
                    ),
                  )
                }
              >
                <option value="">
                  {t("Choose saved food", "Выберите сохранённый продукт")}
                </option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.brand && `· ${p.brand}`}
                  </option>
                ))}
              </select>
            </Field>
            <button
              type="button"
              aria-label={t(
                `Remove ingredient ${index + 1}`,
                `Удалить ингредиент ${index + 1}`,
              )}
              onClick={() =>
                onChange(ingredients.filter((_, n) => n !== index))
              }
            >
              ×
            </button>
          </div>
          <QuantityFields
            value={i}
            product={products.find((p) => p.id === i.productId)}
            onChange={(q) =>
              onChange(
                ingredients.map((v, n) =>
                  n === index ? { ...q, productId: v.productId } : v,
                ),
              )
            }
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([
            ...ingredients,
            { productId: products[0]?.id || "", amount: 100, unit: "g" },
          ])
        }
      >
        {t("＋ Add ingredient", "＋ Добавить ингредиент")}
      </button>
    </>
  );
}
function DishForm({
  dish,
  products,
  busy,
  onSave,
  onPreview,
}: {
  dish?: Dish;
  products: Product[];
  busy: boolean;
  onSave: (d: DishInput) => void;
  onPreview: (d: DishInput) => void;
}) {
  const { t, label } = useAppI18n();
  const [draft, setDraft] = useState<DishInput>(
    dish
      ? (({ id: _id, updatedAt: _at, ...rest }) => rest)(dish)
      : { name: "", ingredients: [], servings: 1, notes: "" },
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draft);
      }}
    >
      {dish && (
        <p className="form-note">
          {t(
            "Saving corrections recalculates linked journal entries. For a different recipe or batch, create a new dish instead. Older entries and manual overrides stay fixed.",
            "Изменения пересчитают связанные записи дневника. Для другого рецепта или партии создайте новое блюдо. Старые записи и ручные корректировки сохранятся.",
          )}
        </p>
      )}
      <Field label={t("Dish name", "Название блюда")}>
        <input
          autoFocus
          required
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </Field>
      <div className="row">
        <Field label={t("Recipe makes (servings)", "Выход рецепта (порций)")}>
          <input
            required
            type="number"
            min="0.01"
            step="any"
            value={draft.servings}
            onChange={(e) =>
              setDraft({ ...draft, servings: Number(e.target.value) })
            }
          />
        </Field>
        <Field
          label={t(
            "Cooked weight (g, optional)",
            "Вес готового блюда (г, необязательно)",
          )}
        >
          <input
            type="number"
            min="0.01"
            step="any"
            value={draft.cookedWeight || ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                cookedWeight: e.target.value
                  ? Number(e.target.value)
                  : undefined,
              })
            }
          />
        </Field>
      </div>
      <h3>{t("What goes in", "Ингредиенты")}</h3>
      {!products.length && (
        <p className="hint">
          {t(
            "Save some foods in the Foods tab first.",
            "Сначала сохраните продукты на вкладке «Продукты».",
          )}
        </p>
      )}
      <IngredientFields
        ingredients={draft.ingredients}
        products={products}
        onChange={(ingredients) => setDraft({ ...draft, ingredients })}
      />
      <Field label={t("Notes", "Заметки")}>
        <textarea
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
      </Field>
      <footer className="form-footer">
        <button
          type="button"
          disabled={busy || !draft.ingredients.length}
          onClick={() => onPreview(draft)}
        >
          {t("Calculate nutrition", "Рассчитать пищевую ценность")}
        </button>
        <Submit busy={busy || !draft.ingredients.length}>
          {t("Save dish", "Сохранить блюдо")}
        </Submit>
      </footer>
    </form>
  );
}
function LogForm({
  products,
  dishes,
  target,
  defaultDate,
  defaultUnit,
  busy,
  onSave,
}: {
  products: Product[];
  dishes: Dish[];
  target?: Product | Dish;
  defaultDate: string;
  defaultUnit: "g" | "oz";
  busy: boolean;
  onSave: (input: unknown) => void;
}) {
  const { t, num, label } = useAppI18n();
  const [id, setId] = useState(target?.id || "");
  const [quantity, setQuantity] = useState<Quantity>({
    amount:
      target && "ingredients" in target ? 1 : defaultUnit === "g" ? 100 : 1,
    unit: target && "ingredients" in target ? "serving" : defaultUnit,
  });
  const [date, setDate] = useState(defaultDate);
  const [meal, setMeal] = useState("snack");
  const [notes, setNotes] = useState("");
  const [overrides, setOverrides] = useState<DishInput["ingredients"]>();
  const [key] = useState(() => crypto.randomUUID());
  const product = products.find((p) => p.id === id);
  const dish = dishes.find((d) => d.id === id);
  function submit(e: FormEvent) {
    e.preventDefault();
    const input = {
      ...quantity,
      date,
      meal,
      notes,
      ...(dish
        ? { dishId: dish.id, ingredients: overrides }
        : { productId: id }),
    };
    // Keep the identity of this intended log even after an uncertain response.
    // A changed retry is rejected by the server instead of silently duplicating it.
    onSave({ ...input, idempotencyKey: key });
  }
  return (
    <form onSubmit={submit}>
      <Field label={t("Food or dish", "Продукт или блюдо")}>
        <select
          autoFocus
          required
          value={id}
          onChange={(e) => {
            setId(e.target.value);
            setOverrides(undefined);
            const isDish = dishes.some((d) => d.id === e.target.value);
            setQuantity({
              amount: isDish ? 1 : defaultUnit === "g" ? 100 : 1,
              unit: isDish ? "serving" : defaultUnit,
            });
          }}
        >
          <option value="">
            {t("Choose from your saved collection", "Выберите из сохранённого")}
          </option>
          <optgroup label={label("Foods")}>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.brand && `· ${p.brand}`}
              </option>
            ))}
          </optgroup>
          <optgroup label={label("Dishes")}>
            {dishes.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </optgroup>
        </select>
      </Field>
      {!products.length && (
        <p className="hint">
          {t(
            "Add a product in Foods first. Search by name, brand, or barcode, or copy a label into a custom food.",
            "Сначала добавьте продукт на вкладке «Продукты»: найдите по названию, бренду или штрихкоду либо перепишите этикетку.",
          )}
        </p>
      )}
      <QuantityFields
        value={quantity}
        onChange={setQuantity}
        product={product}
        dish={!!dish}
      />
      {dish && (
        <p className="hint">
          {t(
            `This recipe makes ${num(dish.servings)} servings. Logging 1 serving uses ${num(100 / dish.servings)}% of its ingredients.`,
            `Рецепт рассчитан на ${num(dish.servings)} порций. Одна порция использует ${num(100 / dish.servings)}% ингредиентов.`,
          )}
        </p>
      )}
      <div className="row">
        <Field label={t("Date eaten", "Дата приёма пищи")}>
          <input
            required
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label={t("Meal", "Приём пищи")}>
          <select value={meal} onChange={(e) => setMeal(e.target.value)}>
            {["breakfast", "lunch", "dinner", "snack"].map((m) => (
              <option key={m} value={m}>
                {label(m)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {dish && (
        <details>
          <summary>
            {t("Different recipe this time?", "В этот раз другой рецепт?")}
          </summary>
          <p>
            {t(
              `Adjust the full recipe’s ingredients for this log. The saved template stays the same; the serving yield remains ${num(dish.servings)}.`,
              `Измените ингредиенты всего рецепта для этой записи. Сохранённый рецепт не изменится; выход останется ${num(dish.servings)} порций.`,
            )}
          </p>
          <button
            type="button"
            onClick={() => {
              setOverrides(dish.ingredients.map((i) => ({ ...i })));
              setQuantity({ amount: 1, unit: "serving" });
            }}
          >
            {t("Customize this meal", "Изменить этот приём пищи")}
          </button>
          {overrides && (
            <IngredientFields
              ingredients={overrides}
              products={products}
              onChange={setOverrides}
            />
          )}
        </details>
      )}
      <Field label={t("Notes (optional)", "Заметки (необязательно)")}>
        <textarea
          placeholder={t(
            "Anything you’d like to remember",
            "Что вы хотите запомнить",
          )}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      <footer className="form-footer">
        <Submit busy={busy || !id}>
          {t("Add to journal", "Добавить в дневник")}
        </Submit>
      </footer>
    </form>
  );
}
function EntryRow({
  entry,
  onDelete,
  onEdit,
}: {
  entry: Entry;
  onDelete: () => Promise<void>;
  onEdit: (changes: EntryUpdate) => Promise<Entry>;
}) {
  const { t, language, locale, num, label } = useAppI18n();
  const [opened, setOpened] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(entry);
  const [componentAmount, setComponentAmount] = useState(entry.amount);
  const totals = Object.fromEntries(
    nutrientKeys.flatMap((k) => {
      const values = draft.items
        .map((i) => i.nutrients[k])
        .filter((v) => v !== undefined);
      return values.length ? [[k, values.reduce((a, b) => a + b, 0)]] : [];
    }),
  ) as Nutrients;
  const changeItem = (
    index: number,
    changes: Partial<Entry["items"][number]>,
  ) =>
    setDraft({
      ...draft,
      items: draft.items.map((item, i) =>
        i === index ? { ...item, ...changes } : item,
      ),
    });
  const close = () => {
    if (busy) return;
    if (
      editing &&
      JSON.stringify(draft) !== JSON.stringify(entry) &&
      !confirm(
        t(
          "Discard your unsaved entry changes?",
          "Отменить несохранённые изменения записи?",
        ),
      )
    )
      return;
    setOpened(false);
  };
  return (
    <>
      <article className="entry">
        <button
          className="entry-open"
          aria-label={t(
            `View entry: ${entry.name}`,
            `Открыть запись: ${entry.name}`,
          )}
          onClick={() => {
            setDraft(structuredClone(entry));
            setComponentAmount(entry.amount);
            setError("");
            setEditing(false);
            setOpened(true);
          }}
        >
          <span className="entry-icon" aria-hidden="true">
            {entry.meal === "breakfast"
              ? "◔"
              : entry.meal === "dinner"
                ? "◒"
                : "◈"}
          </span>
          <span className="entry-content">
            <strong>{entry.name}</strong>
            <small>
              {num(entry.amount)} {label(entry.unit)} · {label(entry.meal)} ·{" "}
              {DateTime.fromISO(entry.date)
                .setLocale(locale)
                .toLocaleString(DateTime.DATE_MED)}
            </small>
            {entry.notes && <small>{entry.notes}</small>}
            <small>
              {t("View details &amp; edit →", "Подробности и редактирование →")}
            </small>
          </span>
          <span className="entry-energy">
            <strong>{num(entry.nutrients.calories)}</strong>
            <small>{t("kcal", "ккал")}</small>
          </span>
        </button>
      </article>
      {opened && (
        <Modal
          title={
            editing
              ? t("Edit journal entry", "Изменить запись дневника")
              : draft.name
          }
          onClose={close}
        >
          {error && (
            <p className="error" role="alert">
              {localizeError(error, language)}
            </p>
          )}
          {!editing ? (
            <>
              <p>
                {num(draft.amount)} {label(draft.unit)} · {label(draft.meal)} ·{" "}
                {DateTime.fromISO(draft.date)
                  .setLocale(locale)
                  .toLocaleString(DateTime.DATE_MED)}
              </p>
              {draft.notes && <p>{draft.notes}</p>}
              <p className="muted">
                {draft.autoUpdate
                  ? t(
                      "Automatically updates when its saved food or recipe changes.",
                      "Автоматически обновляется при изменении сохранённого продукта или рецепта.",
                    )
                  : t(
                      "Fixed values: saved food and recipe edits do not change this entry.",
                      "Фиксированные значения: изменения продуктов и рецептов не влияют на эту запись.",
                    )}
              </p>
              <h3>{t("Entry nutrition", "Пищевая ценность записи")}</h3>
              <dl className="nutrient-list">
                {nutrientKeys.map((k) => (
                  <div key={k}>
                    <dt>{label(nutrientLabels[k])}</dt>
                    <dd>{num(draft.nutrients[k])}</dd>
                  </div>
                ))}
              </dl>
              <h3>{t("Components", "Компоненты")}</h3>
              {draft.items.map((item, i) => (
                <div className="ingredient" key={i}>
                  <strong>{item.name}</strong>
                  <p>
                    {num(item.grams)} {label("g")} ·{" "}
                    {num(item.nutrients.calories)}
                    {t("kcal", "ккал")}
                  </p>
                </div>
              ))}
              <div className="form-footer">
                <button
                  className="danger"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      !confirm(
                        t(
                          `Delete ${draft.name} from your journal?`,
                          `Удалить ${draft.name} из дневника?`,
                        ),
                      )
                    )
                      return;
                    setBusy(true);
                    setError("");
                    try {
                      await onDelete();
                      setOpened(false);
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "Could not delete entry.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t("Delete entry", "Удалить запись")}
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => setEditing(true)}
                >
                  {t("Edit entry", "Изменить запись")}
                </button>
              </div>
            </>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  const updated = await onEdit({
                    id: entry.id,
                    expectedRevision: draft.revision || 0,
                    name: draft.name,
                    date: draft.date,
                    meal: draft.meal as EntryUpdate["meal"],
                    notes: draft.notes,
                    amount: draft.amount,
                    unit: draft.unit as EntryUpdate["unit"],
                    items: draft.items as EntryUpdate["items"],
                  });
                  setDraft(updated);
                  setComponentAmount(updated.amount);
                  setEditing(false);
                  setOpened(false);
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Could not save entry.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <fieldset disabled={busy} className="entry-fields">
                {draft.autoUpdate && (
                  <p className="form-note">
                    {t(
                      "Changing the name, amount or components fixes this entry’s values and stops automatic updates. Date, meal and notes alone keep it linked.",
                      "Изменение названия, количества или компонентов фиксирует значения и отключает автообновление. Изменение только даты, приёма пищи или заметок сохраняет связь.",
                    )}
                  </p>
                )}
                <p className="form-note">
                  {t(
                    "Edits apply only to this entry. Nutrition values below are totals for each component, not per 100g. Blank means unknown. Entry totals are calculated from components.",
                    "Изменения относятся только к этой записи. Ниже указаны полные значения для каждого компонента, а не на 100 г. Пустое поле означает неизвестное значение. Итог записи складывается из компонентов.",
                  )}
                </p>
                <Field label={t("Entry name", "Название записи")}>
                  <input
                    required
                    maxLength={200}
                    value={draft.name}
                    onChange={(e) =>
                      setDraft({ ...draft, name: e.target.value })
                    }
                  />
                </Field>
                <div className="row">
                  <Field label={t("Entry date", "Дата записи")}>
                    <input
                      type="date"
                      required
                      value={draft.date}
                      onChange={(e) =>
                        setDraft({ ...draft, date: e.target.value })
                      }
                    />
                  </Field>
                  <Field label={t("Entry meal", "Приём пищи записи")}>
                    <select
                      value={draft.meal}
                      onChange={(e) =>
                        setDraft({ ...draft, meal: e.target.value })
                      }
                    >
                      {["breakfast", "lunch", "dinner", "snack"].map((m) => (
                        <option key={m} value={m}>
                          {label(m)}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="row">
                  <Field label={t("Entry amount", "Количество в записи")}>
                    <input
                      type="number"
                      required
                      min="0.001"
                      max="100000"
                      step="any"
                      value={draft.amount || ""}
                      onChange={(e) =>
                        setDraft({ ...draft, amount: Number(e.target.value) })
                      }
                    />
                  </Field>
                  <Field label={t("Entry unit", "Единица записи")}>
                    <select
                      value={draft.unit}
                      onChange={(e) =>
                        setDraft({ ...draft, unit: e.target.value })
                      }
                    >
                      {units.map((u) => (
                        <option key={u} value={u}>
                          {label(u)}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <p className="muted">
                  {t(
                    `Amount and unit describe the entry. To resize the same portion, scale from ${num(componentAmount)} to ${num(draft.amount)}; otherwise edit the component totals directly. Changing units does not convert nutrition.`,
                    `Количество и единица описывают запись. Чтобы изменить размер той же порции, пересчитайте с ${num(componentAmount)} на ${num(draft.amount)}; иначе измените значения компонентов вручную. Смена единиц не пересчитывает пищевую ценность.`,
                  )}
                </p>
                <button
                  type="button"
                  disabled={!draft.amount || draft.amount === componentAmount}
                  onClick={() => {
                    const factor = draft.amount / componentAmount;
                    setDraft({
                      ...draft,
                      items: draft.items.map((item) => ({
                        ...item,
                        grams: item.grams * factor,
                        nutrients: Object.fromEntries(
                          Object.entries(item.nutrients).map(([k, v]) => [
                            k,
                            v! * factor,
                          ]),
                        ),
                      })),
                    });
                    setComponentAmount(draft.amount);
                  }}
                >
                  {t(
                    "Scale components to this amount",
                    "Пересчитать компоненты на это количество",
                  )}
                </button>
                <Field label={t("Entry notes", "Заметки к записи")}>
                  <textarea
                    maxLength={2000}
                    value={draft.notes}
                    onChange={(e) =>
                      setDraft({ ...draft, notes: e.target.value })
                    }
                  />
                </Field>
                <h3>{t("Components", "Компоненты")}</h3>
                {draft.items.map((item, i) => (
                  <fieldset className="ingredient" key={i}>
                    <legend>
                      {t(`Component ${i + 1}`, `Компонент ${i + 1}`)}
                    </legend>
                    <Field label={t("Component name", "Название компонента")}>
                      <input
                        required
                        maxLength={200}
                        value={item.name}
                        onChange={(e) =>
                          changeItem(i, { name: e.target.value })
                        }
                      />
                    </Field>
                    <div className="row">
                      <Field label={t("Component grams", "Вес компонента, г")}>
                        <input
                          required
                          type="number"
                          min="0.001"
                          max="100000"
                          step="any"
                          value={item.grams || ""}
                          onChange={(e) =>
                            changeItem(i, { grams: Number(e.target.value) })
                          }
                        />
                      </Field>
                      <Field label={t("Calories (kcal)", "Калории (ккал)")}>
                        <input
                          required
                          type="number"
                          min="0"
                          max="100000"
                          step="any"
                          value={item.nutrients.calories ?? ""}
                          onChange={(e) => {
                            const nutrients = { ...item.nutrients };
                            if (e.target.value === "")
                              delete nutrients.calories;
                            else nutrients.calories = Number(e.target.value);
                            changeItem(i, { nutrients });
                          }}
                        />
                      </Field>
                    </div>
                    <details>
                      <summary>
                        {t(
                          "Macros and other nutrients",
                          "БЖУ и другие нутриенты",
                        )}
                      </summary>
                      <div className="nutrient-fields">
                        {nutrientKeys
                          .filter((k) => k !== "calories")
                          .map((k) => (
                            <Field key={k} label={label(nutrientLabels[k])}>
                              <input
                                type="number"
                                min="0"
                                max="100000"
                                step="any"
                                value={item.nutrients[k] ?? ""}
                                onChange={(e) => {
                                  const nutrients = { ...item.nutrients };
                                  if (e.target.value === "")
                                    delete nutrients[k];
                                  else nutrients[k] = Number(e.target.value);
                                  changeItem(i, { nutrients });
                                }}
                              />
                            </Field>
                          ))}
                      </div>
                    </details>
                    <button
                      type="button"
                      className="danger"
                      disabled={draft.items.length === 1}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          items: draft.items.filter((_, j) => i !== j),
                        })
                      }
                    >
                      {t(
                        `Remove component ${i + 1}`,
                        `Удалить компонент ${i + 1}`,
                      )}
                    </button>
                  </fieldset>
                ))}
                <button
                  type="button"
                  disabled={draft.items.length >= 100}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      items: [
                        ...draft.items,
                        { name: "", grams: 1, nutrients: {} },
                      ],
                    })
                  }
                >
                  {t("Add component", "Добавить компонент")}
                </button>
                <p role="status">
                  {t(
                    `Entry total: ${num(totals.calories)} kcal · Protein ${num(totals.protein)} g · Carbs ${num(totals.carbs)} g · Fat ${num(totals.fat)} g`,
                    `Итого: ${num(totals.calories)} ккал · Белок ${num(totals.protein)} г · Углеводы ${num(totals.carbs)} г · Жиры ${num(totals.fat)} г`,
                  )}
                </p>
                <div className="form-footer">
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        JSON.stringify(draft) === JSON.stringify(entry) ||
                        confirm(
                          t(
                            "Discard your unsaved entry changes?",
                            "Отменить несохранённые изменения записи?",
                          ),
                        )
                      ) {
                        setDraft(structuredClone(entry));
                        setComponentAmount(entry.amount);
                        setEditing(false);
                        setError("");
                      }
                    }}
                  >
                    {t("Cancel editing", "Отменить изменения")}
                  </button>
                  <Submit busy={busy}>
                    {t("Save correction", "Сохранить корректировку")}
                  </Submit>
                </div>
              </fieldset>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
function Settings({
  user,
  setUser,
  perform,
  busy,
  notify,
}: {
  user: User;
  setUser: (u: User | null) => void;
  perform: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
  notify: (m: string) => void;
}) {
  const { t, locale, label } = useAppI18n();
  const [tokens, setTokens] = useState<
    { id: string; name: string; expires_at: string }[]
  >([]);
  const [secret, setSecret] = useState("");
  const refresh = () => api<typeof tokens>("/api/tokens").then(setTokens);
  useEffect(() => {
    void perform(refresh);
  }, []);
  return (
    <div className="settings-grid">
      <section className="panel">
        <h2>{t("Preferences", "Настройки")}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void perform(async () => {
              setUser(
                await action<User>("update_profile", Object.fromEntries(f)),
              );
              notify("Preferences saved.");
            });
          }}
        >
          <Field label={t("Timezone", "Часовой пояс")}>
            <input
              name="timezone"
              defaultValue={user.timezone}
              list="timezones"
              required
            />
            <datalist id="timezones">
              {[
                "America/Los_Angeles",
                "America/New_York",
                "America/Chicago",
                "Europe/London",
                "Europe/Berlin",
                "Asia/Tokyo",
                "UTC",
              ].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </datalist>
          </Field>
          <p className="muted">
            {t(
              "“Today” uses this timezone. Past entries keep the date you logged.",
              "«Сегодня» определяется этим часовым поясом. Даты прошлых записей не меняются.",
            )}
          </p>
          <Field label={t("Default units", "Единицы по умолчанию")}>
            <select name="unitSystem" defaultValue={user.unitSystem}>
              <option value="metric">
                {t("Metric · grams", "Метрические · граммы")}
              </option>
              <option value="us">
                {t("US · ounces", "Американские · унции")}
              </option>
            </select>
          </Field>
          <Submit busy={busy}>
            {t("Save preferences", "Сохранить настройки")}
          </Submit>
        </form>
        <h2 className="spaced">{t("Change password", "Сменить пароль")}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void perform(async () => {
              await api("/api/password", Object.fromEntries(f));
              setUser(null);
            });
          }}
        >
          <Field label={t("Current password", "Текущий пароль")}>
            <input
              type="password"
              autoComplete="current-password"
              name="currentPassword"
              required
            />
          </Field>
          <Field
            label={t(
              "New password (14+ characters)",
              "Новый пароль (от 14 символов)",
            )}
          >
            <input
              type="password"
              autoComplete="new-password"
              name="newPassword"
              minLength={14}
              required
            />
          </Field>
          <Submit busy={busy}>
            {t("Change & sign out", "Сменить и выйти")}
          </Submit>
        </form>
        <div className="spaced">
          <button
            onClick={() =>
              void perform(async () => {
                await api("/api/logout", {});
                setUser(null);
              })
            }
          >
            {t("Sign out of this account", "Выйти из аккаунта")}
          </button>
        </div>
      </section>
      <section className="panel">
        <span className="eyebrow">
          {t("MADE FOR YOUR AGENT", "ДЛЯ ВАШЕГО АГЕНТА")}
        </span>
        <h2>{t("Connect with MCP", "Подключение через MCP")}</h2>
        <p>
          {t(
            "In Claude, add this connector URL, choose sign-in and automatic client registration. Other clients can use a token in the Authorization header.",
            "В Claude добавьте этот URL коннектора, выберите вход и автоматическую регистрацию клиента. Другие клиенты могут передавать токен в заголовке Authorization.",
          )}
        </p>
        <code className="block-code">{location.origin}/mcp</code>
        <pre>{`{"url":"${location.origin}/mcp",\n "headers":{"Authorization":"Bearer YOUR_TOKEN"}}`}</pre>
        <p>
          <a href="/agent-skill.md" target="_blank" rel="noreferrer">
            {t("Read the agent skill ↗", "Прочитать навык агента ↗")}
          </a>{" "}
          ·{" "}
          <a href="/calorie-ledger-skill.zip" download>
            {t(
              "Download skill ZIP for Claude",
              "Скачать ZIP навыка для Claude",
            )}
          </a>
        </p>
        <p>
          {t(
            "In Claude, enable code execution in Settings → Capabilities, then open Customize → Skills → + → Create skill → Upload a skill. Upload the ZIP and enable it. The skill teaches food matching, cooked/dry conversions and missing-label research; the MCP connector provides access to your ledger. Re-upload the latest ZIP when the skill changes.",
            "В Claude включите выполнение кода в Settings → Capabilities, затем откройте Customize → Skills → + → Create skill → Upload a skill. Загрузите ZIP и включите навык. Он обучает подбору продуктов, пересчёту сухого и готового веса и поиску недостающих данных; коннектор MCP даёт доступ к дневнику. При обновлении навыка загрузите новый ZIP.",
          )}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void perform(async () => {
              const result = await api<{ token: string }>(
                "/api/tokens",
                Object.fromEntries(f),
              );
              setSecret(result.token);
              await refresh();
            });
          }}
        >
          <Field label={t("New token name", "Название нового токена")}>
            <input name="name" required placeholder="Hermes" maxLength={80} />
          </Field>
          <Submit busy={busy}>
            {t("Create agent token", "Создать токен агента")}
          </Submit>
        </form>
        {secret && (
          <div className="secret">
            <strong>
              {t(
                "Copy now — shown only once.",
                "Скопируйте сейчас — токен показывается один раз.",
              )}
            </strong>
            <code className="block-code">{secret}</code>
            <button
              onClick={() =>
                void perform(async () => {
                  await navigator.clipboard.writeText(secret);
                  notify("Token copied.");
                })
              }
            >
              {t("Copy token", "Скопировать токен")}
            </button>
            <button onClick={() => setSecret("")}>{t("Hide", "Скрыть")}</button>
          </div>
        )}
        <div className="token-list">
          {tokens.map((token) => (
            <div className="food-row" key={token.id}>
              <div>
                <strong>{token.name}</strong>
                <small>
                  {t("Expires", "Действует до")}{" "}
                  {DateTime.fromISO(token.expires_at)
                    .setLocale(locale)
                    .toLocaleString(DateTime.DATE_MED)}
                </small>
              </div>
              <button
                className="danger"
                onClick={() => {
                  if (
                    confirm(
                      t(`Revoke ${token.name}?`, `Отозвать ${token.name}?`),
                    )
                  )
                    void perform(async () => {
                      await api("/api/tokens/revoke", { id: token.id });
                      await refresh();
                      setSecret("");
                      notify("Token revoked.");
                    });
                }}
              >
                {t("Revoke", "Отозвать")}
              </button>
            </div>
          ))}
        </div>
        <small>
          {t(
            "Tokens can access only your account. They expire after one year and can be revoked at any time.",
            "Токены дают доступ только к вашему аккаунту. Они действуют один год и могут быть отозваны в любое время.",
          )}
        </small>
      </section>
    </div>
  );
}
