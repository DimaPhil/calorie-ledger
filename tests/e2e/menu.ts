import { expect, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

export async function checkMenu(page: Page, info: TestInfo) {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(page.locator(".menu-card")).toHaveCount(22);
  // Menu imports use real saved-food nutrition and never log a meal.
  await page
    .getByRole("button", { name: "Open recipe: Tuna & spinach frittata" })
    .click();
  await page.getByLabel("Number of servings").selectOption("2");
  await page.getByRole("button", { name: "Save as dish", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save dish", exact: true }),
  ).toBeDisabled();
  await expect(
    page.locator(".menu-import .ingredient input").first(),
  ).toHaveValue("500");
  await page
    .getByRole("button", { name: "＋ New food", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Food name", { exact: true })
    .fill("Menu import test ingredient");
  await page.getByLabel("Energy (kcal)", { exact: true }).fill("100");
  await page.getByRole("button", { name: "Save food", exact: true }).click();
  const selectors = page.locator(".menu-import .ingredient select");
  await expect(selectors).toHaveCount(10);
  for (const select of await selectors.all()) {
    await select.selectOption({ label: "Menu import test ingredient" });
  }
  await page
    .getByRole("button", { name: "Preview nutrition", exact: true })
    .click();
  await expect(page.locator(".menu-import [role=status]")).toContainText(
    "Per serving",
  );
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(() =>
        page
          .getByRole("dialog")
          .evaluate((el) => el.scrollWidth - el.clientWidth),
      )
      .toBeLessThanOrEqual(1);
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("dialog").evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({ path: info.outputPath("phone-menu-import.png") });
  await page
    .getByLabel("I reviewed the foods, preparation states and amounts.")
    .check();
  await page.getByRole("button", { name: "Save dish", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.locator(".food-card").filter({ hasText: "Tuna & spinach frittata" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByLabel("Find a recipe or ingredient").fill("frittata");
  await expect(page.locator(".menu-card")).toHaveCount(1);
  const recipe = page.getByRole("button", {
    name: "Open recipe: Tuna & spinach frittata",
  });
  await recipe.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".menu-nutrition")).toContainText("495.2");
  await dialog.getByLabel("Number of servings").selectOption("2");
  await expect(dialog.locator(".menu-nutrition")).toContainText("495.2");
  await expect(dialog.locator(".menu-batch")).toContainText("990.4");
  await dialog
    .getByRole("checkbox", { name: "Liquid egg whites — 500 g", exact: true })
    .check();
  await dialog.getByLabel("Step 1 complete").check();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(() => dialog.evaluate((el) => el.scrollWidth - el.clientWidth))
      .toBeLessThanOrEqual(1);
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await dialog.evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({ path: info.outputPath("phone-menu-recipe.png") });
  await page.keyboard.press("Escape");
  await expect(recipe).toBeFocused();
  await page
    .getByRole("button", { name: "Favorite: Tuna & spinach frittata" })
    .click();
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page
    .getByRole("button", { name: "Favorites (1)", exact: true })
    .click();
  await expect(page.locator(".menu-card")).toHaveCount(1);
  await page
    .getByLabel("Find a recipe or ingredient")
    .fill("несуществующий рецепт");
  await expect(page.locator(".menu-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Show all recipes" }).click();
  await expect(page.locator(".menu-card")).toHaveCount(22);
  await page.getByLabel("Main protein").selectOption("tuna");
  await expect(page.locator(".menu-card")).toHaveCount(5);
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: info.outputPath("phone-menu.png"),
  });

  // The global choice updates an open recipe across tabs without losing its state.
  await page
    .getByRole("button", { name: "Open recipe: Tuna & spinach frittata" })
    .click();
  await page.getByLabel("Number of servings").selectOption("2");
  await page.getByLabel("Step 1 complete").check();
  const other = await page.context().newPage();
  await other.goto("/");
  await other.getByLabel("Language / Язык", { exact: true }).selectOption("ru");
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(page.getByRole("dialog")).toContainText(
    "Фриттата с тунцом и шпинатом",
  );
  await expect(page.getByLabel("Количество порций")).toHaveValue("2");
  await expect(page.getByLabel("Шаг 1 выполнен")).toBeChecked();
  await page.getByRole("button", { name: "Закрыть окно" }).click();
  await other.close();
  for (const tab of [
    "Дневник",
    "Прогресс",
    "Продукты",
    "Блюда",
    "Меню",
    "Настройки",
  ]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    for (const width of [320, 390, 744]) {
      await page.setViewportSize({ width, height: 844 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth,
          ),
        )
        .toBeLessThanOrEqual(1);
    }
  }
  await page.reload();
  await expect(page.getByLabel("Language / Язык", { exact: true })).toHaveValue(
    "ru",
  );
  await page.getByRole("button", { name: "Меню", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByLabel("Language / Язык", { exact: true }).selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator(".menu-card")).toHaveCount(22);
}
