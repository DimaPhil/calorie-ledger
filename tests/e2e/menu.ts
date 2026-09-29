import { expect, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

export async function checkMenu(page: Page, info: TestInfo) {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(page.locator(".menu-card")).toHaveCount(22);
  await page.getByLabel("Найти рецепт или ингредиент").fill("фриттата");
  await expect(page.locator(".menu-card")).toHaveCount(1);
  const recipe = page.getByRole("button", {
    name: "Открыть рецепт: Фриттата с тунцом и шпинатом",
  });
  await recipe.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".menu-nutrition")).toContainText("495,2");
  await dialog.getByLabel("Количество порций").selectOption("2");
  await expect(dialog.locator(".menu-nutrition")).toContainText("495,2");
  await expect(dialog.locator(".menu-batch")).toContainText("990,4");
  await dialog
    .getByRole("checkbox", { name: "Жидкие яичные белки — 500 г", exact: true })
    .check();
  await dialog.getByLabel("Шаг 1 выполнен").check();
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
    .getByRole("button", { name: "Избранное: Фриттата с тунцом и шпинатом" })
    .click();
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page
    .getByRole("button", { name: "Избранное (1)", exact: true })
    .click();
  await expect(page.locator(".menu-card")).toHaveCount(1);
  await page
    .getByLabel("Найти рецепт или ингредиент")
    .fill("несуществующий рецепт");
  await expect(page.locator(".menu-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Показать все рецепты" }).click();
  await expect(page.locator(".menu-card")).toHaveCount(22);
  await page.getByLabel("Основной белок").selectOption("tuna");
  await expect(page.locator(".menu-card")).toHaveCount(5);
  await page.getByRole("button", { name: "Сбросить", exact: true }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: info.outputPath("phone-menu.png"),
  });
}
