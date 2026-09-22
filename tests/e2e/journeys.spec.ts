import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("food → dish → custom meal → statistics → token lifecycle", async ({
  page,
}, testInfo) => {
  const name = `Oats ${testInfo.project.name}`;
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("tester");
  await page
    .getByLabel("Password", { exact: true })
    .fill("test-password-12345");
  await page.getByRole("button", { name: "Sign in →" }).click();
  await expect(
    page.getByRole("heading", { name: "Your day, on the record." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Foods", exact: true }).click();
  await page.getByRole("button", { name: "＋ Custom food" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Food name", { exact: true }).fill(name);
  await dialog.getByLabel("Brand", { exact: true }).fill("Everyday");
  await dialog.getByLabel("Energy (kcal)", { exact: true }).fill("400");
  await dialog.getByLabel("Protein (g)", { exact: true }).fill("10");
  await dialog.getByLabel("Carbs (g)", { exact: true }).fill("60");
  await dialog.getByLabel("Fat (g)", { exact: true }).fill("8");
  await dialog.getByLabel("Sugar (g)", { exact: true }).fill("2");
  await dialog.getByRole("button", { name: "＋ Add portion" }).click();
  await dialog.getByLabel("Portion label").fill("one bar");
  await dialog.getByLabel("Portion unit").selectOption("piece");
  await dialog.getByLabel("Grams per unit").fill("40");
  await dialog.getByRole("button", { name: "Save food", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const food = page
    .locator(".food-card")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
  await food.getByRole("button", { name: "Log food", exact: true }).click();
  await dialog.getByLabel("Amount", { exact: true }).fill("50");
  await dialog.getByLabel("Meal", { exact: true }).selectOption("breakfast");
  await dialog.getByRole("button", { name: "Add to journal" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Dishes", exact: true }).click();
  await page.getByRole("button", { name: "＋ New dish" }).click();
  await dialog
    .getByLabel("Dish name")
    .fill(`Breakfast bowl ${testInfo.project.name}`);
  await dialog.getByLabel("Recipe makes (servings)").fill("2");
  await dialog.getByRole("button", { name: "＋ Add ingredient" }).click();
  await dialog
    .getByLabel("Ingredient 1", { exact: true })
    .selectOption({ label: `${name} · Everyday` });
  await dialog.getByLabel("Amount", { exact: true }).fill("100");
  await dialog.getByRole("button", { name: "Save dish", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const dish = page.locator(".food-card").filter({
    has: page.getByRole("heading", {
      name: `Breakfast bowl ${testInfo.project.name}`,
      exact: true,
    }),
  });
  await dish.getByRole("button", { name: "Log dish" }).click();
  await dialog.getByText("Different recipe this time?").click();
  await dialog.getByRole("button", { name: "Customize this meal" }).click();
  await dialog
    .locator(".ingredient")
    .getByLabel("Amount", { exact: true })
    .fill("200");
  await dialog
    .getByLabel("Notes (optional)")
    .fill(`More oats today ${testInfo.project.name}`);
  await dialog.getByRole("button", { name: "Add to journal" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await expect(
    page.getByText(`More oats today ${testInfo.project.name}`, { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".entry")
      .filter({ hasText: `Breakfast bowl ${testInfo.project.name}` })
      .locator(".entry-energy"),
  ).toContainText("400");
  for (const period of ["Week", "Month", "Custom", "Today"]) {
    await page.getByRole("button", { name: period, exact: true }).click();
    await expect(page.locator(".entries")).toBeVisible();
  }
  await expect(page.locator("body")).toHaveJSProperty(
    "scrollWidth",
    await page.locator("body").evaluate((e) => e.clientWidth),
  );
  await page.screenshot({
    path: `test-results/journal-${testInfo.project.name}.png`,
    fullPage: true,
  });
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByLabel("New token name")
    .fill(`Hermes ${testInfo.project.name}`);
  await page.getByRole("button", { name: "Create agent token" }).click();
  await expect(page.locator(".secret code")).toContainText("cl_");
  page.once("dialog", (d) => d.accept());
  await page
    .locator(".token-list .food-row")
    .filter({ hasText: `Hermes ${testInfo.project.name}` })
    .getByRole("button", { name: "Revoke" })
    .click();
  await expect(page.getByText("Token revoked.", { exact: true })).toBeVisible();
});
test("switching accounts clears products, search results and nutrition totals", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("tester");
  await page
    .getByLabel("Password", { exact: true })
    .fill("test-password-12345");
  await page.getByRole("button", { name: "Sign in →" }).click();
  await page.getByRole("button", { name: "Foods", exact: true }).click();
  await page
    .getByLabel("Search products")
    .fill(`Oats ${testInfo.project.name}`);
  await page.getByRole("button", { name: "Search foods", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Search results", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Sign out of this account" }).click();
  await page.route("**/api/actions/list_products", async (route) => {
    await new Promise((r) => setTimeout(r, 250));
    await route.continue();
  });
  await page.getByLabel("Username", { exact: true }).fill("other");
  await page
    .getByLabel("Password", { exact: true })
    .fill("other-password-12345");
  await page.getByRole("button", { name: "Sign in →" }).click();
  await page.getByRole("button", { name: "Foods", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Search results", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".food-card")).toHaveCount(0);
  await expect(page.getByText("Your favorites belong here.")).toBeVisible();
});
test("a committed log with a lost response cannot be duplicated by editing and retrying", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("tester");
  await page
    .getByLabel("Password", { exact: true })
    .fill("test-password-12345");
  await page.getByRole("button", { name: "Sign in →" }).click();
  await page.getByRole("button", { name: "Foods", exact: true }).click();
  const food = page.locator(".food-card").filter({
    has: page.getByRole("heading", {
      name: `Oats ${testInfo.project.name}`,
      exact: true,
    }),
  });
  await food.getByRole("button", { name: "Log food", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Date eaten").fill("2026-06-01");
  await page.route(
    "**/api/actions/log_food",
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await dialog.getByRole("button", { name: "Add to journal" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByLabel("Amount", { exact: true }).fill("200");
  await dialog.getByRole("button", { name: "Add to journal" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Review the journal");
  const result = await page.request.post("/api/actions/get_stats", {
    headers: { Origin: "http://127.0.0.1:3100" },
    data: { start: "2026-06-01", end: "2026-06-01" },
  });
  const stats = await result.json();
  expect(
    stats.entries.filter(
      (e: { name: string }) => e.name === `Oats ${testInfo.project.name}`,
    ),
  ).toHaveLength(1);
});
test("keyboard dialog, incomplete food, and provider outage", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("tester");
  await page
    .getByLabel("Password", { exact: true })
    .fill("test-password-12345");
  await page.getByRole("button", { name: "Sign in →" }).click();
  await page.getByRole("button", { name: "Foods", exact: true }).click();
  await page.getByLabel("Search products").fill("Unknown cereal");
  await page.getByRole("button", { name: "Search foods", exact: true }).click();
  await expect(
    page.getByText("External lookup is disabled in automated tests."),
  ).toBeVisible();
  await page.getByRole("button", { name: "＋ Custom food" }).click();
  await expect(page.getByLabel("Food name", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "＋ Custom food" }),
  ).toBeFocused();
});
