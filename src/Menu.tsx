import { useState } from "react";
import { Modal } from "./Modal";
import source from "./menu-data.json";
import english from "./menu-en.json";
import { useI18n } from "./i18n.js";
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
type RecipeText = Pick<
  Recipe,
  "title" | "sub" | "equip" | "tips" | "store" | "vary"
> & {
  ing: string[][];
  steps: string[];
};
const translations = english as {
  recipes: Record<string, RecipeText>;
  proteinLabels: Record<string, string>;
  featureLabels: Record<string, string>;
  meals: Record<string, string>;
  levels: Record<string, string>;
  shopping: Record<string, string[]>;
};
function recipeInEnglish(recipe: Recipe): Recipe {
  const text = translations.recipes[recipe.id];
  return {
    ...recipe,
    ...text,
    level: translations.levels[recipe.level],
    ing: recipe.ing.map(([key, amount], i) =>
      key === "#"
        ? [key, text.ing[i][0]]
        : ([key, amount, ...text.ing[i]] as Recipe["ing"][number]),
    ),
    steps: recipe.steps.map(([, minutes], i) => [text.steps[i], minutes]),
  };
}
const englishRecipes = data.recipes.map(recipeInEnglish);

export function Menu({ userId }: { userId: string }) {
  const { language, locale, t } = useI18n();
  const number = (value: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  const localizedRecipes = language === "en" ? englishRecipes : data.recipes;
  const [query, setQuery] = useState("");
  const [protein, setProtein] = useState("");
  const [meal, setMeal] = useState("");
  const [feature, setFeature] = useState("");
  const [sort, setSort] = useState("original");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [selected, setSelected] = useState<string>();
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
  const recipes = localizedRecipes
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
    <section
      className="menu-view"
      lang={language}
      aria-label={t("Recipe menu", "Меню рецептов")}
    >
      <div className="menu-intro">
        <p>
          {t(
            "Breakfast, lunch and dinner ideas with protein, everyday ingredients and step-by-step directions.",
            "Идеи для завтрака, обеда и ужина — с белком, понятными ингредиентами и пошаговым приготовлением.",
          )}
        </p>
        <p className="muted">
          {t(
            "Nutrition values are estimates. Browsing recipes does not add journal entries.",
            "Пищевая ценность приблизительная. Просмотр рецептов не добавляет записи в журнал.",
          )}
        </p>
      </div>
      <div className="menu-controls">
        <label className="menu-search">
          {t("Find a recipe or ingredient", "Найти рецепт или ингредиент")}
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t(
              "Tuna, chicken, avocado…",
              "Тунец, курица, авокадо…",
            )}
          />
        </label>
        <label>
          {t("Main protein", "Основной белок")}
          <select value={protein} onChange={(e) => setProtein(e.target.value)}>
            <option value="">{t("Any", "Любой")}</option>
            {Object.entries(data.proteinLabels).map(([key, value]) => (
              <option key={key} value={key}>
                {t(translations.proteinLabels[key], value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Meal", "Приём пищи")}
          <select value={meal} onChange={(e) => setMeal(e.target.value)}>
            <option value="">{t("Any", "Любой")}</option>
            {data.meals.map((value) => (
              <option key={value} value={value}>
                {t(translations.meals[value], value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Convenience", "Удобство")}
          <select value={feature} onChange={(e) => setFeature(e.target.value)}>
            <option value="">{t("All recipes", "Все рецепты")}</option>
            {Object.entries(data.featureLabels).map(([key, value]) => (
              <option key={key} value={key}>
                {t(translations.featureLabels[key], value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Sort", "Сортировка")}
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="original">{t("Default", "По умолчанию")}</option>
            <option value="protein">{t("Most protein", "Больше белка")}</option>
            <option value="calories">
              {t("Fewest calories", "Меньше калорий")}
            </option>
            <option value="time">
              {t("Quickest to make", "Быстрее готовить")}
            </option>
            <option value="density">
              {t("Protein per 100 kcal", "Белок на 100 ккал")}
            </option>
          </select>
        </label>
      </div>
      <div className="menu-results-heading">
        <p aria-live="polite">
          {t("Recipes", "Рецептов")}: {recipes.length}
        </p>
        <div>
          <button
            aria-pressed={onlyFavorites}
            onClick={() => setOnlyFavorites(!onlyFavorites)}
          >
            {t("Favorites", "Избранное")} ({favorites.length})
          </button>
          <button onClick={reset}>{t("Reset", "Сбросить")}</button>
        </div>
      </div>
      <p className="menu-device-note muted">
        {t(
          "Favorites are saved on this device only.",
          "Избранное сохраняется только на этом устройстве.",
        )}
        {saveError &&
          t(
            " Storage is unavailable; your selection will last until you close this tab.",
            " Сохранение недоступно; выбор останется до закрытия вкладки.",
          )}
      </p>
      {recipes.length ? (
        <div className="menu-grid">
          {recipes.map((r) => (
            <article className="menu-card" key={r.id}>
              <button
                className="menu-open"
                onClick={() => setSelected(r.id)}
                aria-label={`${t("Open recipe", "Открыть рецепт")}: ${r.title}`}
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
                    {r.prep + r.cook} {t("min", "мин")} · {r.level}
                  </p>
                  <h2>{r.title}</h2>
                  <p>{r.sub}</p>
                  <div className="menu-card-macros">
                    <strong>
                      {number(r.macros[0])} {t("kcal", "ккал")}
                    </strong>
                    <strong>
                      {number(r.macros[1])} {t("g protein", "г белка")}
                    </strong>
                    <span>{t("per serving", "на порцию")}</span>
                  </div>
                </div>
              </button>
              <button
                className="menu-favorite"
                aria-label={`${t("Favorite", "Избранное")}: ${r.title}`}
                aria-pressed={favorites.includes(r.id)}
                onClick={() => favorite(r.id)}
              >
                {favorites.includes(r.id)
                  ? t("★ Saved", "★ В избранном")
                  : t("☆ Save favorite", "☆ В избранное")}
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="menu-empty">
          <h2>{t("No recipes found", "Ничего не нашлось")}</h2>
          <p>
            {t(
              "Try another ingredient or clear the filters.",
              "Попробуйте другой ингредиент или уберите фильтры.",
            )}
          </p>
          <button onClick={reset}>
            {t("Show all recipes", "Показать все рецепты")}
          </button>
        </div>
      )}
      {selected && (
        <RecipeView
          key={selected}
          recipe={localizedRecipes.find((recipe) => recipe.id === selected)!}
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
  const { language, locale, t } = useI18n();
  const number = (value: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  const macroLabels = [
    t("kcal", "ккал"),
    t("g protein", "г белка"),
    t("g fat", "г жиров"),
    t("g carbs", "г углеводов"),
  ];
  const [servings, setServings] = useState(r.servings);
  const factor = servings / r.servings;
  const shops = [
    ...new Set(
      r.ing.flatMap(([key]) => (key && data.shopping[key] ? [key] : [])),
    ),
  ];
  return (
    <Modal title={r.title} onClose={onClose}>
      <div className="menu-recipe" lang={language}>
        <img
          className="menu-recipe-image"
          src={`/menu/${r.id}.svg`}
          width="400"
          height="220"
          alt=""
        />
        <p>{r.sub}</p>
        <p className="muted">
          {t("Prep", "Подготовка")}: {r.prep} {t("min", "мин")} ·{" "}
          {t("Cook", "Приготовление")}: {r.cook} {t("min", "мин")} · {r.level}
        </p>
        <section aria-label={t("Nutrition", "Пищевая ценность")}>
          <h3>{t("Per serving", "На одну порцию")}</h3>
          <div className="menu-nutrition">
            {r.macros.map((value, i) => (
              <div key={i}>
                <strong>{number(value)}</strong>
                <span>{macroLabels[i]}</span>
              </div>
            ))}
          </div>
          <p className="muted">
            {t(
              "Estimated from the original recipe: brands and substitutions change the result. The ingredient list specifies raw, cooked or drained weights where known.",
              "Оценка по исходному рецепту: марки продуктов и замены изменяют результат. Состояние продукта (сырой, готовый, слитый) указано в ингредиентах, где оно известно.",
            )}
          </p>
          <label className="menu-servings">
            {t("Number of servings", "Количество порций")}
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
            {t("Whole recipe", "На всё блюдо")}:{" "}
            {r.macros
              .map(
                (value, i) => `${number(value * servings)} ${macroLabels[i]}`,
              )
              .join(" · ")}
          </p>
        </section>
        <section>
          <h3>{t("Ingredients", "Ингредиенты")}</h3>
          {factor !== 1 && (
            <p className="muted">
              {t(
                `Gram amounts are scaled to ${servings} servings. Approximate measures from the original recipe are hidden. Season to taste.`,
                `Граммы пересчитаны на ${servings} порц. Приблизительные меры исходного рецепта скрыты. Специи — по вкусу.`,
              )}
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
                        <strong>
                          {" "}
                          — {number(amount * factor)} {t("g", "г")}
                        </strong>
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
          <h3>{t("Directions", "Приготовление")}</h3>
          <p className="muted">
            {t(
              "Check off completed steps. Checkmarks reset when you close the recipe.",
              "Отмечайте готовые шаги. Отметки сбросятся при закрытии рецепта.",
            )}
          </p>
          {factor !== 1 && (
            <p className="muted">
              {t(
                `Directions, timing and cookware sizes below are for the original ${r.servings} servings. Use the scaled ingredient amounts. When changing batch size, cook in batches and check doneness.`,
                `Текст шагов, время и размеры посуды ниже — для исходных ${r.servings} порц. Количества берите из пересчитанного списка ингредиентов. При изменении объёма готовьте партиями и проверяйте готовность.`,
              )}
            </p>
          )}
          <ol className="menu-checklist menu-steps">
            {r.steps.map(([text, minutes], i) => (
              <li key={i}>
                <label>
                  <input
                    type="checkbox"
                    aria-label={t(
                      `Step ${i + 1} complete`,
                      `Шаг ${i + 1} выполнен`,
                    )}
                  />
                  <span>
                    <strong>{i + 1}. </strong>
                    {text}
                    {minutes !== undefined && (
                      <small>
                        {minutes} {t("min", "мин")}
                      </small>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ol>
        </section>
        <details>
          <summary>{t("Equipment & tips", "Посуда и полезные советы")}</summary>
          <h4>{t("You will need", "Понадобится")}</h4>
          <ul>
            {r.equip.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <h4>{t("Tips", "Советы")}</h4>
          <ul>
            {r.tips.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
        <details>
          <summary>{t("Storage & substitutions", "Хранение и замены")}</summary>
          <p>{r.store}</p>
          <ul>
            {r.vary.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
        {shops.length > 0 && (
          <details>
            <summary>
              {t("Where to find ingredients", "Где искать ингредиенты")}
            </summary>
            <p className="muted">
              {t(
                "Suggestions from the original menu, not current store inventory. Check availability and ingredients when shopping.",
                "Подсказки из исходного меню, не текущие остатки магазинов. Наличие и состав проверяйте при покупке.",
              )}
            </p>
            <ul className="menu-shopping">
              {shops.map((key) => {
                const [ruName, ruNote, availability] = data.shopping[key];
                const [name, note] =
                  language === "en"
                    ? translations.shopping[key]
                    : [ruName, ruNote];
                return (
                  <li key={key}>
                    <strong>{name}</strong>
                    <p>{note}</p>
                    <small>
                      {data.stores
                        .flatMap((store, i) =>
                          availability[i]
                            ? [
                                `${store}${availability[i] === 1 ? t(" (not always available)", " (не всегда)") : ""}`,
                              ]
                            : [],
                        )
                        .join(" · ") ||
                        t(
                          "Check availability in store",
                          "Уточните наличие в магазине",
                        )}
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
