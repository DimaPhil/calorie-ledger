import { useState, type ReactNode } from "react";
import {
  action,
  type Product,
  type ProductInput,
  type Nutrients,
} from "./shared.js";
import { useI18n, localizeError } from "./i18n.js";
import type { MenuRecipe } from "./menu-shared.js";

export type MenuDishProps = {
  products: Product[];
  onSaved: () => void;
  renderFood: (
    name: string,
    busy: boolean,
    onSave: (food: ProductInput) => void,
  ) => ReactNode;
};

export function MenuDish({
  recipe,
  servings,
  products,
  onSaved,
  renderFood,
  onBusyChange,
}: MenuDishProps & {
  recipe: MenuRecipe;
  servings: number;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t, language, locale } = useI18n();
  const [foods, setFoods] = useState(products);
  const [rows, setRows] = useState(() =>
    recipe.ing.flatMap(([key, amount, name], index) => {
      if (key === "#" || typeof amount !== "number" || amount <= 0) return [];
      const matches = products.filter(
        (p) => p.name.trim().toLowerCase() === name?.trim().toLowerCase(),
      );
      return [
        {
          index,
          productId: matches.length === 1 ? matches[0].id : "",
          amount: (amount * servings) / recipe.servings,
        },
      ];
    }),
  );
  const [adding, setAdding] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Nutrients>();
  const [confirmed, setConfirmed] = useState(false);
  const complete = rows.every((row) => row.productId && row.amount > 0);
  async function perform(fn: () => Promise<void>) {
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        localizeError(e instanceof Error ? e.message : String(e), language),
      );
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  const number = (n: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n);
  if (adding !== undefined)
    return (
      <section className="menu-import">
        <button
          type="button"
          disabled={busy}
          onClick={() => setAdding(undefined)}
        >
          {t("Back to ingredients", "Назад к ингредиентам")}
        </button>
        <p>
          {t(
            "Save this food to your collection, then continue matching ingredients.",
            "Сохраните продукт в коллекцию и продолжите сопоставление ингредиентов.",
          )}
        </p>
        {error && <p role="alert">{error}</p>}
        {renderFood(
          recipe.ing[adding][2] || "",
          busy,
          (product) =>
            void perform(async () => {
              const food = await action<Product>("save_product", { product });
              setFoods((old) => [...old, food]);
              setRows((old) =>
                old.map((row) =>
                  row.index === adding ? { ...row, productId: food.id } : row,
                ),
              );
              window.dispatchEvent(new Event("ledger-foods-changed"));
              setAdding(undefined);
            }),
        )}
      </section>
    );
  return (
    <form
      className="menu-import"
      onSubmit={(event) => {
        event.preventDefault();
        if (!complete || !confirmed || busy) return;
        void perform(async () => {
          await action("create_menu_dish", {
            recipeId: recipe.id,
            language,
            servings,
            ingredients: rows,
          });
          onSaved();
        });
      }}
    >
      <h3>{t("Save as dish", "Сохранить как блюдо")}</h3>
      <p>
        {t(
          `Match ingredients to your foods and review the grams for ${servings} servings. Nutrition is calculated from these foods, not the menu estimate.`,
          `Сопоставьте ингредиенты с продуктами и проверьте граммы на ${servings} порц. Пищевая ценность рассчитывается по этим продуктам, а не по оценке меню.`,
        )}
      </p>
      <p className="muted">
        {t(
          "Use the raw, cooked or drained state shown in the recipe. Unweighed seasonings stay in the recipe notes and are not counted. You can edit the saved dish afterwards.",
          "Выбирайте сырые, готовые или слитые продукты, как указано в рецепте. Специи без веса останутся в заметках и не войдут в расчёт. Сохранённое блюдо можно редактировать.",
        )}
      </p>
      <fieldset
        disabled={busy}
        onChange={() => {
          setPreview(undefined);
          setConfirmed(false);
        }}
      >
        {rows.map((row) => (
          <div className="ingredient" key={row.index}>
            {recipe.ing[row.index][3] && (
              <p className="muted">
                {t("Original recipe note", "Примечание исходного рецепта")}:{" "}
                {recipe.ing[row.index][3]}
              </p>
            )}
            <label className="field">
              <span>{recipe.ing[row.index][2]}</span>
              <select
                required
                value={row.productId}
                onChange={(e) =>
                  setRows(
                    rows.map((r) =>
                      r.index === row.index
                        ? { ...r, productId: e.target.value }
                        : r,
                    ),
                  )
                }
              >
                <option value="">
                  {t("Choose saved food", "Выберите сохранённый продукт")}
                </option>
                {foods.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                    {p.brand ? ` · ${p.brand}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="row">
              <label className="field">
                <span>{t("Grams", "Граммы")}</span>
                <input
                  type="number"
                  required
                  min="0.001"
                  max="100000"
                  step="any"
                  value={row.amount}
                  onChange={(e) =>
                    setRows(
                      rows.map((r) =>
                        r.index === row.index
                          ? { ...r, amount: Number(e.target.value) }
                          : r,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  setAdding(row.index);
                  setPreview(undefined);
                  setConfirmed(false);
                }}
              >
                {t("＋ New food", "＋ Новый продукт")}
              </button>
            </div>
          </div>
        ))}
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {preview && (
        <p role="status">
          {t("Per serving", "На порцию")}: {number(preview.calories || 0)} kcal
          · {t("Protein", "Белки")}{" "}
          {preview.protein === undefined ? "—" : number(preview.protein)} g ·{" "}
          {t("Fat", "Жиры")}{" "}
          {preview.fat === undefined ? "—" : number(preview.fat)} g ·{" "}
          {t("Carbs", "Углеводы")}{" "}
          {preview.carbs === undefined ? "—" : number(preview.carbs)} g
          <br />
          {t(
            "Known nutrient values only; missing values are not zero.",
            "Только известные значения; отсутствующие данные не равны нулю.",
          )}
        </p>
      )}
      <label className="menu-import-confirm">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={busy || !complete}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        {t(
          "I reviewed the foods, preparation states and amounts.",
          "Я проверил продукты, состояние и количества.",
        )}
      </label>
      <footer className="form-footer">
        <button
          type="button"
          disabled={busy || !complete}
          onClick={() =>
            void perform(async () => {
              const result = await action<{ perServing: Nutrients }>(
                "preview_dish",
                {
                  dish: {
                    name: recipe.title,
                    servings,
                    ingredients: rows.map(({ productId, amount }) => ({
                      productId,
                      amount,
                      unit: "g",
                    })),
                    notes: "",
                  },
                },
              );
              setPreview(result.perServing);
            })
          }
        >
          {t("Preview nutrition", "Рассчитать питание")}
        </button>
        <button
          className="primary"
          type="submit"
          disabled={busy || !complete || !confirmed}
        >
          {busy
            ? t("Saving…", "Сохранение…")
            : t("Save dish", "Сохранить блюдо")}
        </button>
      </footer>
    </form>
  );
}
