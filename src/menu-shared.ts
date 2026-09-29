import source from "./menu-data.json";
import english from "./menu-en.json";

export type MenuRecipe = {
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
export const menuData = source as unknown as {
  recipes: MenuRecipe[];
  proteinLabels: Record<string, string>;
  featureLabels: Record<string, string>;
  meals: string[];
  stores: string[];
  shopping: Record<string, [string, string, number[]]>;
};
type RecipeText = Pick<
  MenuRecipe,
  "title" | "sub" | "equip" | "tips" | "store" | "vary"
> & {
  ing: string[][];
  steps: string[];
};
export const menuTranslations = english as {
  recipes: Record<string, RecipeText>;
  proteinLabels: Record<string, string>;
  featureLabels: Record<string, string>;
  meals: Record<string, string>;
  levels: Record<string, string>;
  shopping: Record<string, string[]>;
};
const englishRecipes = menuData.recipes.map((recipe): MenuRecipe => {
  const text = menuTranslations.recipes[recipe.id];
  return {
    ...recipe,
    ...text,
    level: menuTranslations.levels[recipe.level],
    ing: recipe.ing.map(([key, amount], i) =>
      key === "#"
        ? [key, text.ing[i][0]]
        : ([key, amount, ...text.ing[i]] as MenuRecipe["ing"][number]),
    ),
    steps: recipe.steps.map(([, minutes], i) => [text.steps[i], minutes]),
  };
});

export function listMenuRecipes(language: "en" | "ru" = "en"): MenuRecipe[] {
  return language === "en" ? englishRecipes : menuData.recipes;
}

export function getMenuRecipe(id: string, language: "en" | "ru" = "en") {
  return listMenuRecipes(language).find((recipe) => recipe.id === id);
}
