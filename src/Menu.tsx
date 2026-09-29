import { useState } from "react";
import { Modal } from "./Modal";
import source from "./menu-data.json";
import "./menu.css";

type Recipe = {
  id: string;
  title: string;
  meals: string[];
  prep: number;
  cook: number;
  servings: number;
  level: string;
  sub: string;
  equip: string[];
  ing: [string | null, number | string, string?, string?][];
  steps: [string, number?][];
  tips: string[];
  store: string;
  vary: string[];
  macros: number[];
  groups: string[];
  features: string[];
};
const data = source as unknown as {
  recipes: Recipe[];
  proteinLabels: Record<string, string>;
  featureLabels: Record<string, string>;
  meals: string[];
  stores: string[];
  shopping: Record<string, [string, string, number[]]>;
};
const normalized = (text: string) =>
  text.toLocaleLowerCase("ru").replaceAll("ё", "е");
const number = (value: number) =>
  new Intl.NumberFormat("ru", { maximumFractionDigits: 1 }).format(value);
const macroLabels = ["ккал", "г белка", "г жиров", "г углеводов"];

export function Menu({ userId }: { userId: string }) {
  const [query, setQuery] = useState("");
  const [protein, setProtein] = useState("");
  const [meal, setMeal] = useState("");
  const [feature, setFeature] = useState("");
  const [sort, setSort] = useState("original");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [selected, setSelected] = useState<Recipe>();
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem(`menu-favorites:${userId}`) || "[]",
      );
      return Array.isArray(saved)
        ? saved.filter((id) => data.recipes.some((r) => r.id === id))
        : [];
    } catch {
      return [];
    }
  });
  const [saveError, setSaveError] = useState(false);
  function favorite(id: string) {
    const next = favorites.includes(id)
      ? favorites.filter((value) => value !== id)
      : [...favorites, id];
    setFavorites(next);
    try {
      localStorage.setItem(`menu-favorites:${userId}`, JSON.stringify(next));
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }
  function reset() {
    setQuery("");
    setProtein("");
    setMeal("");
    setFeature("");
    setOnlyFavorites(false);
    setSort("original");
  }
  const recipes = data.recipes
    .filter(
      (r) =>
        (!protein || r.groups.includes(protein)) &&
        (!meal || r.meals.includes(meal)) &&
        (!feature || r.features.includes(feature)) &&
        (!onlyFavorites || favorites.includes(r.id)) &&
        normalized(
          [r.title, r.sub, ...r.ing.map((i) => i[2] || "")].join(" "),
        ).includes(normalized(query.trim())),
    )
    .sort((a, b) =>
      sort === "protein"
        ? b.macros[1] - a.macros[1]
        : sort === "calories"
          ? a.macros[0] - b.macros[0]
          : sort === "time"
            ? a.prep + a.cook - b.prep - b.cook
            : sort === "density"
              ? b.macros[1] / b.macros[0] - a.macros[1] / a.macros[0]
              : 0,
    );
  return (
    <section className="menu-view" lang="ru" aria-label="Меню рецептов">
      <div className="menu-intro">
        <p>
          Идеи для завтрака, обеда и ужина — с белком, понятными ингредиентами и
          пошаговым приготовлением.
        </p>
        <p className="muted">
          Пищевая ценность приблизительная. Просмотр рецептов не добавляет
          записи в журнал.
        </p>
      </div>
      <div className="menu-controls">
        <label className="menu-search">
          Найти рецепт или ингредиент
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Тунец, курица, авокадо…"
          />
        </label>
        <label>
          Основной белок
          <select value={protein} onChange={(e) => setProtein(e.target.value)}>
            <option value="">Любой</option>
            {Object.entries(data.proteinLabels).map(([key, value]) => (
              <option key={key} value={key}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Приём пищи
          <select value={meal} onChange={(e) => setMeal(e.target.value)}>
            <option value="">Любой</option>
            {data.meals.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Удобство
          <select value={feature} onChange={(e) => setFeature(e.target.value)}>
            <option value="">Все рецепты</option>
            {Object.entries(data.featureLabels).map(([key, value]) => (
              <option key={key} value={key}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Сортировка
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="original">По умолчанию</option>
            <option value="protein">Больше белка</option>
            <option value="calories">Меньше калорий</option>
            <option value="time">Быстрее готовить</option>
            <option value="density">Белок на 100 ккал</option>
          </select>
        </label>
      </div>
      <div className="menu-results-heading">
        <p aria-live="polite">Рецептов: {recipes.length}</p>
        <div>
          <button
            aria-pressed={onlyFavorites}
            onClick={() => setOnlyFavorites(!onlyFavorites)}
          >
            Избранное ({favorites.length})
          </button>
          <button onClick={reset}>Сбросить</button>
        </div>
      </div>
      <p className="menu-device-note muted">
        Избранное сохраняется только на этом устройстве.
        {saveError &&
          " Сохранение недоступно; выбор останется до закрытия вкладки."}
      </p>
      {recipes.length ? (
        <div className="menu-grid">
          {recipes.map((r) => (
            <article className="menu-card" key={r.id}>
              <button
                className="menu-open"
                onClick={() => setSelected(r)}
                aria-label={`Открыть рецепт: ${r.title}`}
              >
                <img
                  src={`/menu/${r.id}.svg`}
                  loading="lazy"
                  width="400"
                  height="220"
                  alt=""
                />
                <div className="menu-card-copy">
                  <p className="menu-card-meta">
                    {r.prep + r.cook} мин · {r.level}
                  </p>
                  <h2>{r.title}</h2>
                  <p>{r.sub}</p>
                  <div className="menu-card-macros">
                    <strong>{number(r.macros[0])} ккал</strong>
                    <strong>{number(r.macros[1])} г белка</strong>
                    <span>на порцию</span>
                  </div>
                </div>
              </button>
              <button
                className="menu-favorite"
                aria-label={`Избранное: ${r.title}`}
                aria-pressed={favorites.includes(r.id)}
                onClick={() => favorite(r.id)}
              >
                {favorites.includes(r.id) ? "★ В избранном" : "☆ В избранное"}
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="menu-empty">
          <h2>Ничего не нашлось</h2>
          <p>Попробуйте другой ингредиент или уберите фильтры.</p>
          <button onClick={reset}>Показать все рецепты</button>
        </div>
      )}
      {selected && (
        <RecipeView
          key={selected.id}
          recipe={selected}
          onClose={() => setSelected(undefined)}
        />
      )}
    </section>
  );
}

function RecipeView({
  recipe: r,
  onClose,
}: {
  recipe: Recipe;
  onClose: () => void;
}) {
  const [servings, setServings] = useState(r.servings);
  const factor = servings / r.servings;
  const shops = [
    ...new Set(
      r.ing.flatMap(([key]) => (key && data.shopping[key] ? [key] : [])),
    ),
  ];
  return (
    <Modal title={r.title} onClose={onClose}>
      <div className="menu-recipe" lang="ru">
        <img
          className="menu-recipe-image"
          src={`/menu/${r.id}.svg`}
          width="400"
          height="220"
          alt=""
        />
        <p>{r.sub}</p>
        <p className="muted">
          Подготовка: {r.prep} мин · Приготовление: {r.cook} мин · {r.level}
        </p>
        <section aria-label="Пищевая ценность">
          <h3>На одну порцию</h3>
          <div className="menu-nutrition">
            {r.macros.map((value, i) => (
              <div key={i}>
                <strong>{number(value)}</strong>
                <span>{macroLabels[i]}</span>
              </div>
            ))}
          </div>
          <p className="muted">
            Оценка по исходному рецепту: марки продуктов и замены изменяют
            результат. Состояние продукта (сырой, готовый, слитый) указано в
            ингредиентах, где оно известно.
          </p>
          <label className="menu-servings">
            Количество порций
            <select
              value={servings}
              onChange={(e) => setServings(Number(e.target.value))}
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1}>{i + 1}</option>
              ))}
            </select>
          </label>
          <p className="menu-batch">
            На всё блюдо:{" "}
            {r.macros
              .map(
                (value, i) => `${number(value * servings)} ${macroLabels[i]}`,
              )
              .join(" · ")}
          </p>
        </section>
        <section>
          <h3>Ингредиенты</h3>
          {factor !== 1 && (
            <p className="muted">
              Граммы пересчитаны на {servings} порц. Приблизительные меры
              исходного рецепта скрыты. Специи — по вкусу.
            </p>
          )}
          <ul className="menu-checklist">
            {r.ing.map(([key, amount, name, note], i) =>
              key === "#" ? (
                <li className="menu-ingredient-group" key={i}>
                  <h4>{amount}</h4>
                </li>
              ) : (
                <li key={i}>
                  <label>
                    <input type="checkbox" />
                    <span>
                      <span>{name}</span>
                      {typeof amount === "number" && amount > 0 && (
                        <strong> — {number(amount * factor)} г</strong>
                      )}
                      {note && (factor === 1 || !amount) && (
                        <small>{note}</small>
                      )}
                    </span>
                  </label>
                </li>
              ),
            )}
          </ul>
        </section>
        <section>
          <h3>Приготовление</h3>
          <p className="muted">
            Отмечайте готовые шаги. Отметки сбросятся при закрытии рецепта.
          </p>
          {factor !== 1 && (
            <p className="muted">
              Текст шагов, время и размеры посуды ниже — для исходных{" "}
              {r.servings} порц. Количества берите из пересчитанного списка
              ингредиентов. При изменении объёма готовьте партиями и проверяйте
              готовность.
            </p>
          )}
          <ol className="menu-checklist menu-steps">
            {r.steps.map(([text, minutes], i) => (
              <li key={i}>
                <label>
                  <input type="checkbox" aria-label={`Шаг ${i + 1} выполнен`} />
                  <span>
                    <strong>{i + 1}. </strong>
                    {text}
                    {minutes !== undefined && <small>{minutes} мин</small>}
                  </span>
                </label>
              </li>
            ))}
          </ol>
        </section>
        <details>
          <summary>Посуда и полезные советы</summary>
          <h4>Понадобится</h4>
          <ul>
            {r.equip.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <h4>Советы</h4>
          <ul>
            {r.tips.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
        <details>
          <summary>Хранение и замены</summary>
          <p>{r.store}</p>
          <ul>
            {r.vary.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
        {shops.length > 0 && (
          <details>
            <summary>Где искать ингредиенты</summary>
            <p className="muted">
              Подсказки из исходного меню, не текущие остатки магазинов. Наличие
              и состав проверяйте при покупке.
            </p>
            <ul className="menu-shopping">
              {shops.map((key) => {
                const [name, note, availability] = data.shopping[key];
                return (
                  <li key={key}>
                    <strong>{name}</strong>
                    <p>{note}</p>
                    <small>
                      {data.stores
                        .flatMap((store, i) =>
                          availability[i]
                            ? [
                                `${store}${availability[i] === 1 ? " (не всегда)" : ""}`,
                              ]
                            : [],
                        )
                        .join(" · ") || "Уточните наличие в магазине"}
                    </small>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </div>
    </Modal>
  );
}
