import {
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

const num = (n?: number) =>
  n === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n);
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
  return (
    <button className="primary" disabled={busy} type="submit">
      {busy ? "Working…" : children}
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
  return (
    <div className="row">
      <Field label="Amount">
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
      <Field label="Unit">
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
              {u === "fl_oz" ? "US fl oz" : u === "cup" ? "US cup" : u}
            </option>
          ))}
        </select>
      </Field>
      {product && product.portions.some((p) => p.unit === value.unit) && (
        <Field label="Portion">
          <select
            value={value.portionLabel || ""}
            onChange={(e) =>
              onChange({ ...value, portionLabel: e.target.value || undefined })
            }
          >
            <option value="">Choose portion</option>
            {product.portions
              .filter((p) => p.unit === value.unit)
              .map((p) => (
                <option key={p.label} value={p.label}>
                  {p.label} · {p.grams}g
                </option>
              ))}
          </select>
        </Field>
      )}
    </div>
  );
}

export function App() {
  const [user, setUser] = useState<User | null>();
  useEffect(() => {
    api<User>("/api/me")
      .then(setUser)
      .catch(() => setUser(null));
  }, []);
  if (user === undefined)
    return <main className="loading">Opening your ledger…</main>;
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
  const [tab, setTab] = useState("Journal");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
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
  const [period, setPeriod] = useState("Today");
  const [dates, setDates] = useState({ start: "", end: "" });
  const today = () =>
    DateTime.now()
      .setZone(user?.timezone || "America/Los_Angeles")
      .toISODate()!;
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
    if (period !== "Custom")
      setDates({
        start: (period === "Week"
          ? now.startOf("week")
          : period === "Month"
            ? now.startOf("month")
            : now
        ).toISODate()!,
        end: now.toISODate()!,
      });
  }, [user, period]);
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
    return <main className="loading">Opening your ledger…</main>;
  if (!user)
    return (
      <main className="login">
        <div className="login-story">
          <a className="brand" href="/">
            ◒ Calorie Ledger
          </a>
          <span className="eyebrow">A LITTLE MORE AWARE, EVERY DAY</span>
          <h1>
            Good food.
            <br />A clear picture.
          </h1>
          <p>
            Your everyday meals, saved favorites, and a little help from your
            agent. One quiet place to keep track.
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
          <span className="eyebrow">YOUR PERSONAL FOOD JOURNAL</span>
          <h2>Welcome back</h2>
          <p>Sign in to your private ledger.</p>
          <Field label="Username">
            <input name="username" autoComplete="username" required autoFocus />
          </Field>
          <Field label="Password">
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <Submit busy={busy}>Sign in →</Submit>
          <small>Private by default. Accounts are invitation-only.</small>
        </form>
      </main>
    );
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          ◒{" "}
          <span>
            Calorie
            <br />
            Ledger
          </span>
        </a>
        <nav aria-label="Main navigation">
          {[
            ["Journal", "◷"],
            ["Foods", "◈"],
            ["Dishes", "▤"],
            ["Settings", "⚙"],
          ].map(([t, icon]) => (
            <button
              key={t}
              aria-current={tab === t ? "page" : undefined}
              className={tab === t ? "selected" : ""}
              onClick={() => {
                setTab(t);
                setError("");
                setNotice("");
              }}
            >
              <span aria-hidden="true">{icon}</span>
              {t}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="avatar">
            {user.username.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{user.username}</strong>
            <small>Your private space</small>
          </div>
          <button
            aria-label="Sign out"
            title="Sign out"
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
                ? DateTime.now().setZone(user.timezone).toFormat("cccc, LLLL d")
                : "YOUR EVERYDAY ESSENTIALS"}
            </span>
            <h1>
              {tab === "Journal"
                ? "Your day, on the record."
                : tab === "Foods"
                  ? "Foods you know."
                  : tab === "Dishes"
                    ? "Make it once. Save it here."
                    : "Make yourself at home."}
            </h1>
            <p>
              {tab === "Journal"
                ? "A little attention goes a long way."
                : tab === "Foods"
                  ? "Find a product, check its label, and make it a regular."
                  : tab === "Dishes"
                    ? "Flexible recipes for the meals you come back to."
                    : "Your preferences, security, and agent connection."}
            </p>
          </div>
          {tab === "Journal" ? (
            <button className="primary" onClick={() => openLog()}>
              ＋ Log food
            </button>
          ) : tab === "Foods" ? (
            <button className="primary" onClick={() => openProduct()}>
              ＋ Custom food
            </button>
          ) : tab === "Dishes" ? (
            <button className="primary" onClick={() => openDish()}>
              ＋ New dish
            </button>
          ) : null}
        </header>
        {error && (
          <div className="error" role="alert">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}
        {tab === "Journal" && (
          <>
            <div className="period-row">
              <div className="segmented" aria-label="Statistics period">
                {["Today", "Week", "Month", "Custom"].map((p) => (
                  <button
                    aria-pressed={period === p}
                    className={period === p ? "active" : ""}
                    key={p}
                    onClick={() => setPeriod(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <div className="date-range">
                {period === "Custom" ? (
                  <>
                    <Field label="From">
                      <input
                        aria-label="From date"
                        type="date"
                        value={dates.start}
                        onChange={(e) =>
                          setDates({ ...dates, start: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Through">
                      <input
                        aria-label="Through date"
                        type="date"
                        value={dates.end}
                        onChange={(e) =>
                          setDates({ ...dates, end: e.target.value })
                        }
                      />
                    </Field>
                  </>
                ) : (
                  <span>
                    {dates.start}{" "}
                    {dates.start !== dates.end && `— ${dates.end}`}
                  </span>
                )}
              </div>
            </div>
            <section className="metrics" aria-label="Nutrition summary">
              <article className="metric energy">
                <span>ENERGY</span>
                <strong>
                  {num(
                    stats?.totals.calories ??
                      (stats?.entries.length === 0 ? 0 : undefined),
                  )}
                  <small> kcal</small>
                </strong>
                <div className="energy-line" />
                <p>
                  {stats?.entries.length || 0} foods logged ·{" "}
                  {period === "Today" ? "today" : "this period"}
                </p>
              </article>
              {(["protein", "carbs", "fat"] as const).map((key, i) => (
                <article className="metric" key={key}>
                  <span>
                    <i className={`dot color-${i}`} />
                    {key.toUpperCase()}
                  </span>
                  <strong>
                    {num(stats?.totals[key])}
                    <small> g</small>
                  </strong>
                  <p>
                    {
                      [
                        "Build & recover",
                        "Everyday energy",
                        "Balance & flavor",
                      ][i]
                    }
                  </p>
                </article>
              ))}
            </section>
            {stats &&
              stats.missingNutrients.some((k) =>
                ["calories", "protein", "carbs", "fat"].includes(k),
              ) && (
                <p className="hint">
                  Some labels are incomplete. Totals include known values only;
                  missing values are never treated as zero.
                </p>
              )}
            <div className="journal-grid">
              <section className="panel">
                <div className="section-heading">
                  <h2>{period === "Today" ? "On the menu" : "Food journal"}</h2>
                  <span className="tag">
                    {stats?.entries.length || 0} entries
                  </span>
                </div>
                {!stats ? (
                  <p>Loading your journal…</p>
                ) : stats.entries.length === 0 ? (
                  <div className="empty">
                    <div className="empty-symbol">◷</div>
                    <h3>A fresh page.</h3>
                    <p>
                      Breakfast, a snack, or last night’s dinner.
                      <br />
                      Start with whatever’s on your mind.
                    </p>
                    <button className="primary" onClick={() => openLog()}>
                      Log your first food
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
              <aside className="right-column">
                <section className="panel soft">
                  <span className="eyebrow">SMALL DETAILS, BIG PICTURE</span>
                  <h2>Beyond calories</h2>
                  <dl className="nutrient-list">
                    {(
                      ["sugar", "fiber", "saturatedFat", "sodium"] as const
                    ).map((k) => (
                      <div key={k}>
                        <dt>{nutrientLabels[k].split(" (")[0]}</dt>
                        <dd>
                          {num(stats?.totals[k])}{" "}
                          <small>{k === "sodium" ? "mg" : "g"}</small>
                          {stats?.missingNutrients.includes(k) ? " *" : ""}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <small>
                    * Incomplete labels. — means unknown or no data.
                  </small>
                  <details>
                    <summary>All nutrients</summary>
                    <dl className="nutrient-list">
                      {nutrientKeys.map((k) => (
                        <div key={k}>
                          <dt>{nutrientLabels[k]}</dt>
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
                  <h3>A little help, on hand.</h3>
                  <p>
                    Tell your agent what you ate. It can find your favorites and
                    take care of the numbers.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => setTab("Settings")}
                  >
                    Connect your agent ↗
                  </button>
                </section>
              </aside>
            </div>
            {stats && stats.days.length > 1 && (
              <section className="panel trend">
                <div className="section-heading">
                  <h2>Day by day</h2>
                  <span>Energy · kcal</span>
                </div>
                <div
                  className="bars"
                  role="img"
                  aria-label={stats.days
                    .map((d) => `${d.date}: ${num(d.nutrients.calories)} kcal`)
                    .join("; ")}
                >
                  {stats.days.map((d) => (
                    <div
                      key={d.date}
                      title={`${d.date}: ${num(d.nutrients.calories)} kcal`}
                    >
                      <span
                        style={{
                          height: `${Math.max(2, ((d.nutrients.calories || 0) / Math.max(1, ...stats.days.map((x) => x.nutrients.calories || 0))) * 110)}px`,
                        }}
                      />
                      <small>{d.date.slice(8)}</small>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
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
                Search products
              </label>
              <input
                id="food-search"
                placeholder="Try a food, brand, or barcode…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                required
              />
              <Submit busy={busy}>Search foods</Submit>
            </form>
            {searchResult && (
              <section className="panel search-results">
                <div className="section-heading">
                  <h2>Search results</h2>
                  <button onClick={() => setSearchResult(undefined)}>
                    Clear
                  </button>
                </div>
                <p>{searchResult.reason}</p>
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
                    Search for other matches
                  </button>
                )}
                {searchResult.warnings.map((w) => (
                  <p className="hint" key={w}>
                    {w}
                  </p>
                ))}
                {searchResult.candidates.map((p) => (
                  <div className="food-row" key={p.id}>
                    <div>
                      <strong>{p.name}</strong>
                      {p.id === searchResult.preferredProductId && (
                        <small>Preferred saved food</small>
                      )}
                      <small>
                        {p.brand || "Unbranded"} · {num(p.nutrients.calories)}{" "}
                        kcal / 100g · {p.source}
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
                      Choose & review
                    </button>
                  </div>
                ))}
              </section>
            )}
            <div className="section-heading">
              <h2>Your saved foods</h2>
              <span>{products.length} products</span>
            </div>
            <div className="cards">
              {products.map((p) => (
                <article className="panel food-card" key={p.id}>
                  <span className="tag">
                    {p.source === "custom"
                      ? "YOUR LABEL"
                      : p.source.toUpperCase()}
                  </span>
                  <h3>{p.name}</h3>
                  <p>{p.brand || "Unbranded"}</p>
                  <strong>
                    {num(p.nutrients.calories)} <small>kcal / 100g</small>
                  </strong>
                  <div className="mini-macros">
                    <span>P {num(p.nutrients.protein)}g</span>
                    <span>C {num(p.nutrients.carbs)}g</span>
                    <span>F {num(p.nutrients.fat)}g</span>
                  </div>
                  <div className="card-actions">
                    <button className="primary" onClick={() => openLog(p)}>
                      Log food
                    </button>
                    <button onClick={() => openProduct(p)}>Edit</button>
                    <button
                      aria-label={`Delete ${p.name}`}
                      onClick={() => {
                        if (confirm(`Delete ${p.name}? Past logs are kept.`))
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
                <h3>Your favorites belong here.</h3>
                <p>
                  Search US products above, or add a food from its nutrition
                  label.
                </p>
                <button onClick={() => openProduct()}>Add custom food</button>
              </div>
            )}
            <p className="attribution">
              Product data from{" "}
              <a
                href="https://fdc.nal.usda.gov"
                target="_blank"
                rel="noreferrer"
              >
                USDA FoodData Central
              </a>{" "}
              and{" "}
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
              . Verify imported values against the label.
            </p>
          </>
        )}
        {tab === "Dishes" && (
          <>
            <div className="cards">
              {dishes.map((d) => (
                <article className="panel food-card" key={d.id}>
                  <span className="tag">YOUR RECIPE</span>
                  <h3>{d.name}</h3>
                  <p>
                    {d.ingredients.length} ingredients · {d.servings} servings
                  </p>
                  <p className="muted">
                    {d.notes ||
                      "Adjust ingredients for each meal without changing your recipe."}
                  </p>
                  <div className="card-actions">
                    <button className="primary" onClick={() => openLog(d)}>
                      Log dish
                    </button>
                    <button onClick={() => openDish(d)}>Edit</button>
                    <button
                      aria-label={`Delete ${d.name}`}
                      onClick={() => {
                        if (confirm(`Delete ${d.name}? Past logs are kept.`))
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
                <h3>Your go-to meal, ready to go.</h3>
                <p>
                  Combine saved foods, set the recipe yield, and let us do the
                  math.
                </p>
                <button className="primary" onClick={() => openDish()}>
                  Create a dish
                </button>
              </div>
            )}
          </>
        )}
        {tab === "Settings" && (
          <Settings
            user={user}
            setUser={setUser}
            perform={perform}
            busy={busy}
            notify={setNotice}
          />
        )}
      </main>
      {modal && (
        <Modal
          title={
            modal === "product"
              ? editProduct
                ? "Edit food"
                : "Add a custom food"
              : modal === "dish"
                ? editDish
                  ? "Edit dish"
                  : "Create a dish"
                : "Log something good"
          }
          onClose={() => {
            if (!busy) {
              setModal(null);
              setError("");
            }
          }}
        >
          <p className="error" role="alert" hidden={!error}>
            {error}
          </p>
          {notice && (
            <p className="notice" role="status">
              {notice}
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
                  setNotice(
                    `Per serving: ${num(result.perServing.calories)} kcal · Protein ${num(result.perServing.protein)}g · Carbs ${num(result.perServing.carbs)}g · Fat ${num(result.perServing.fat)}g.`,
                  );
                })
              }
            />
          )}{" "}
          {modal === "log" && (
            <LogForm
              products={products}
              dishes={dishes}
              target={logTarget}
              defaultDate={today()}
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

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = document.querySelector("dialog")!;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("input,select,textarea")?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = oldOverflow;
      old?.focus();
    };
  }, []);
  return (
    <dialog
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby="modal-title"
    >
      <div className="modal-heading">
        <h2 id="modal-title">{title}</h2>
        <button onClick={onClose} aria-label="Close dialog">
          ×
        </button>
      </div>
      {children}
    </dialog>
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
      <div className="row">
        <Field label="Food name">
          <input
            autoFocus
            required
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </Field>
        <Field label="Brand">
          <input
            value={draft.brand}
            onChange={(e) => setDraft({ ...draft, brand: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Barcode (optional)">
        <input
          value={draft.barcode || ""}
          onChange={(e) => setDraft({ ...draft, barcode: e.target.value })}
        />
      </Field>
      <div className="form-note">
        <strong>Copy what’s on the label.</strong>
        <p>
          Enter the values for the weight below. We’ll convert them to 100g.
          Leave unknown nutrients blank.
        </p>
        <Field label="Label values are for this many grams">
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
          <Field label={nutrientLabels[k]} key={k}>
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
      <h3>Saved portions</h3>
      <p className="muted">
        Grams in one serving, piece, or US measure. A “medium apple” can be an
        approximate portion; use its real weight when convenient.
      </p>
      {draft.portions.map((p, i) => (
        <div className="portion-row" key={i}>
          <Field label="Portion label">
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
          <Field label="Portion unit">
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
                  <option key={u}>{u}</option>
                ))}
            </select>
          </Field>
          <Field label="Grams per unit">
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
            aria-label="Remove portion"
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
        ＋ Add portion
      </button>
      <Field label="Notes">
        <textarea
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
      </Field>
      <footer className="form-footer">
        <Submit busy={busy}>Save food</Submit>
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
  return (
    <>
      {ingredients.map((i, index) => (
        <div className="ingredient" key={index}>
          <div className="row">
            <Field label={`Ingredient ${index + 1}`}>
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
                <option value="">Choose saved food</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.brand && `· ${p.brand}`}
                  </option>
                ))}
              </select>
            </Field>
            <button
              type="button"
              aria-label={`Remove ingredient ${index + 1}`}
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
        ＋ Add ingredient
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
      <Field label="Dish name">
        <input
          autoFocus
          required
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </Field>
      <div className="row">
        <Field label="Recipe makes (servings)">
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
        <Field label="Cooked weight (g, optional)">
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
      <h3>What goes in</h3>
      {!products.length && (
        <p className="hint">Save some foods in the Foods tab first.</p>
      )}
      <IngredientFields
        ingredients={draft.ingredients}
        products={products}
        onChange={(ingredients) => setDraft({ ...draft, ingredients })}
      />
      <Field label="Notes">
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
          Calculate nutrition
        </button>
        <Submit busy={busy || !draft.ingredients.length}>Save dish</Submit>
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
      <Field label="Food or dish">
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
          <option value="">Choose from your saved collection</option>
          <optgroup label="Foods">
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.brand && `· ${p.brand}`}
              </option>
            ))}
          </optgroup>
          <optgroup label="Dishes">
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
          Add a product in Foods first. Search by name, brand, or barcode, or
          copy a label into a custom food.
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
          This recipe makes {dish.servings} servings. Logging 1 serving uses{" "}
          {num(100 / dish.servings)}% of its ingredients.
        </p>
      )}
      <div className="row">
        <Field label="Date eaten">
          <input
            required
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Meal">
          <select value={meal} onChange={(e) => setMeal(e.target.value)}>
            {["breakfast", "lunch", "dinner", "snack"].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
      </div>
      {dish && (
        <details>
          <summary>Different recipe this time?</summary>
          <p>
            Adjust the full recipe’s ingredients for this log. The saved
            template stays the same; the serving yield remains {dish.servings}.
          </p>
          <button
            type="button"
            onClick={() => {
              setOverrides(dish.ingredients.map((i) => ({ ...i })));
              setQuantity({ amount: 1, unit: "serving" });
            }}
          >
            Customize this meal
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
      <Field label="Notes (optional)">
        <textarea
          placeholder="Anything you’d like to remember"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      <footer className="form-footer">
        <Submit busy={busy || !id}>Add to journal</Submit>
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
      !confirm("Discard your unsaved entry changes?")
    )
      return;
    setOpened(false);
  };
  return (
    <>
      <article className="entry">
        <button
          className="entry-open"
          aria-label={`View entry: ${entry.name}`}
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
              {entry.amount} {entry.unit} · {entry.meal} · {entry.date}
            </small>
            {entry.notes && <small>{entry.notes}</small>}
            <small>View details &amp; edit →</small>
          </span>
          <span className="entry-energy">
            <strong>{num(entry.nutrients.calories)}</strong>
            <small>kcal</small>
          </span>
        </button>
      </article>
      {opened && (
        <Modal
          title={editing ? "Edit journal entry" : draft.name}
          onClose={close}
        >
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {!editing ? (
            <>
              <p>
                {draft.amount} {draft.unit} · {draft.meal} · {draft.date}
              </p>
              {draft.notes && <p>{draft.notes}</p>}
              <h3>Entry nutrition</h3>
              <dl className="nutrient-list">
                {nutrientKeys.map((k) => (
                  <div key={k}>
                    <dt>{nutrientLabels[k]}</dt>
                    <dd>{num(draft.nutrients[k])}</dd>
                  </div>
                ))}
              </dl>
              <h3>Components</h3>
              {draft.items.map((item, i) => (
                <div className="ingredient" key={i}>
                  <strong>{item.name}</strong>
                  <p>
                    {num(item.grams)} g · {num(item.nutrients.calories)} kcal
                  </p>
                </div>
              ))}
              <div className="form-footer">
                <button
                  className="danger"
                  disabled={busy}
                  onClick={async () => {
                    if (!confirm(`Delete ${draft.name} from your journal?`))
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
                  Delete entry
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => setEditing(true)}
                >
                  Edit entry
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
                <p className="form-note">
                  Edits apply only to this entry. Nutrition values below are
                  totals for each component, not per 100g. Blank means unknown.
                  Entry totals are calculated from components.
                </p>
                <Field label="Entry name">
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
                  <Field label="Entry date">
                    <input
                      type="date"
                      required
                      value={draft.date}
                      onChange={(e) =>
                        setDraft({ ...draft, date: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Entry meal">
                    <select
                      value={draft.meal}
                      onChange={(e) =>
                        setDraft({ ...draft, meal: e.target.value })
                      }
                    >
                      {["breakfast", "lunch", "dinner", "snack"].map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="row">
                  <Field label="Entry amount">
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
                  <Field label="Entry unit">
                    <select
                      value={draft.unit}
                      onChange={(e) =>
                        setDraft({ ...draft, unit: e.target.value })
                      }
                    >
                      {units.map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <p className="muted">
                  Amount and unit describe the entry. To resize the same
                  portion, scale from {num(componentAmount)} to{" "}
                  {num(draft.amount)}; otherwise edit the component totals
                  directly. Changing units does not convert nutrition.
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
                  Scale components to this amount
                </button>
                <Field label="Entry notes">
                  <textarea
                    maxLength={2000}
                    value={draft.notes}
                    onChange={(e) =>
                      setDraft({ ...draft, notes: e.target.value })
                    }
                  />
                </Field>
                <h3>Components</h3>
                {draft.items.map((item, i) => (
                  <fieldset className="ingredient" key={i}>
                    <legend>Component {i + 1}</legend>
                    <Field label="Component name">
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
                      <Field label="Component grams">
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
                      <Field label="Calories (kcal)">
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
                      <summary>Macros and other nutrients</summary>
                      <div className="nutrient-fields">
                        {nutrientKeys
                          .filter((k) => k !== "calories")
                          .map((k) => (
                            <Field key={k} label={nutrientLabels[k]}>
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
                      Remove component {i + 1}
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
                  Add component
                </button>
                <p role="status">
                  Entry total: {num(totals.calories)} kcal · Protein{" "}
                  {num(totals.protein)} g · Carbs {num(totals.carbs)} g · Fat{" "}
                  {num(totals.fat)} g
                </p>
                <div className="form-footer">
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        JSON.stringify(draft) === JSON.stringify(entry) ||
                        confirm("Discard your unsaved entry changes?")
                      ) {
                        setDraft(structuredClone(entry));
                        setComponentAmount(entry.amount);
                        setEditing(false);
                        setError("");
                      }
                    }}
                  >
                    Cancel editing
                  </button>
                  <Submit busy={busy}>Save correction</Submit>
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
        <h2>Preferences</h2>
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
          <Field label="Timezone">
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
            “Today” uses this timezone. Past entries keep the date you logged.
          </p>
          <Field label="Default units">
            <select name="unitSystem" defaultValue={user.unitSystem}>
              <option value="metric">Metric · grams</option>
              <option value="us">US · ounces</option>
            </select>
          </Field>
          <Submit busy={busy}>Save preferences</Submit>
        </form>
        <h2 className="spaced">Change password</h2>
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
          <Field label="Current password">
            <input
              type="password"
              autoComplete="current-password"
              name="currentPassword"
              required
            />
          </Field>
          <Field label="New password (14+ characters)">
            <input
              type="password"
              autoComplete="new-password"
              name="newPassword"
              minLength={14}
              required
            />
          </Field>
          <Submit busy={busy}>Change & sign out</Submit>
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
            Sign out of this account
          </button>
        </div>
      </section>
      <section className="panel">
        <span className="eyebrow">MADE FOR YOUR AGENT</span>
        <h2>Connect with MCP</h2>
        <p>
          Add this Streamable HTTP endpoint to Hermes or another MCP client. Use
          a token in the Authorization header.
        </p>
        <code className="block-code">{location.origin}/mcp</code>
        <pre>{`{"url":"${location.origin}/mcp",\n "headers":{"Authorization":"Bearer YOUR_TOKEN"}}`}</pre>
        <p>
          <a href="/agent-skill.md" target="_blank" rel="noreferrer">
            Download the agent skill ↗
          </a>{" "}
          · Includes product matching, label extraction, and clarification
          rules.
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
          <Field label="New token name">
            <input name="name" required placeholder="Hermes" maxLength={80} />
          </Field>
          <Submit busy={busy}>Create agent token</Submit>
        </form>
        {secret && (
          <div className="secret">
            <strong>Copy now — shown only once.</strong>
            <code className="block-code">{secret}</code>
            <button
              onClick={() =>
                void perform(async () => {
                  await navigator.clipboard.writeText(secret);
                  notify("Token copied.");
                })
              }
            >
              Copy token
            </button>
            <button onClick={() => setSecret("")}>Hide</button>
          </div>
        )}
        <div className="token-list">
          {tokens.map((t) => (
            <div className="food-row" key={t.id}>
              <div>
                <strong>{t.name}</strong>
                <small>Expires {t.expires_at.slice(0, 10)}</small>
              </div>
              <button
                className="danger"
                onClick={() => {
                  if (confirm(`Revoke ${t.name}?`))
                    void perform(async () => {
                      await api("/api/tokens/revoke", { id: t.id });
                      await refresh();
                      setSecret("");
                      notify("Token revoked.");
                    });
                }}
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
        <small>
          Tokens can access only your account. They expire after one year and
          can be revoked at any time.
        </small>
      </section>
    </div>
  );
}
