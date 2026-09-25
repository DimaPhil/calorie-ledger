import { expect, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { defaultGoals } from "../../src/goals-shared.js";

export async function checkGoals(page: Page, info: TestInfo) {
  await expect(page.locator(".metrics")).toBeVisible();
  const headers = { Origin: "http://127.0.0.1:3100" };
  const post = async (name: string, data: unknown) => {
    const response = await page.request.post(`/api/actions/${name}`, {
      headers,
      data,
    });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const day = "2026-02-10";
  await post("save_goals", { effectiveDate: day, targets: defaultGoals });
  const product = await post("save_product", {
    product: {
      name: `Goal test ${info.project.name}`,
      nutrients: {
        calories: 1050,
        protein: 180,
        fat: 98,
        saturatedFat: 24,
        freeSugar: 30,
        magnesium: 200,
      },
    },
  });
  await post("log_food", {
    productId: product.id,
    amount: 100,
    unit: "g",
    date: day,
    idempotencyKey: `goals-${info.project.name}-${info.retry}`,
  });
  await page.getByLabel("Journal date", { exact: true }).fill(day);
  const card = (name: string) =>
    page
      .locator(".goal-card")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(card("Energy")).toContainText("50%");
  await expect(page.locator(".goal-card")).toHaveCount(4);
  await page.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(page.locator(".goal-card")).toHaveCount(14);
  await page.getByRole("button", { name: "Show less", exact: true }).click();
  await expect(page.locator(".goal-card")).toHaveCount(4);
  await page.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(card("Free sugars")).toContainText("120%");
  await expect(card("Free sugars")).toContainText("Above limit");
  await expect(card("Fiber")).toContainText("Not tracked");
  await expect(card("Fat")).toHaveClass(/goal-over/);
  await expect(card("Saturated fat")).toHaveClass(/goal-over/);
  await expect(card("Protein")).not.toHaveClass(/goal-over/);
  await page
    .getByRole("button", { name: "Show fat contributions", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("98 g / 70 g target");
  await expect(dialog).toContainText("100% of recorded total");
  await expect(dialog).toContainText("100 g eaten → 98 g");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("target-contributions.png") });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Show fat contributions", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Show fiber contributions", exact: true })
    .click();
  await expect(dialog).toContainText("Unknown");
  await expect(dialog).toContainText("unknown values are not zero");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.locator(".daily-checkin summary").click();
  await expect(
    page.getByLabel("Fruit & vegetables total (g)", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Fish portions", { exact: true })).toHaveCount(
    0,
  );
  await page.getByLabel("Drinks total (ml)", { exact: true }).fill("1250");
  await page.getByLabel("Weight (kg)", { exact: true }).fill("95");
  await page.getByLabel("I have finished logging this day").check();
  await page
    .getByRole("button", { name: "Save check-in", exact: true })
    .click();
  await expect(card("Drinks")).toContainText("50%");
  await page
    .getByRole("button", { name: "Show drinks contributions", exact: true })
    .click();
  await expect(dialog).toContainText("Source: daily check-in totals");
  await expect(dialog).toContainText("1,250 ml");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(
    page.getByText("1 / 7 days complete", { exact: true }),
  ).toBeVisible();
  await expect(card("Energy")).toContainText("50%");
  await page.getByRole("button", { name: "Show more", exact: true }).click();
  await page
    .getByRole("button", { name: "Show fiber contributions", exact: true })
    .click();
  await expect(dialog).toContainText("No known days in this interval");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "02-10", exact: true }).click();
  await expect(page.getByLabel("Journal date", { exact: true })).toHaveValue(
    day,
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Apply starting on").fill("2026-02-11");
  await page.getByLabel(/^Energy \(kcal\/day\)/).fill("2200");
  await page.getByRole("button", { name: "Save goals", exact: true }).click();
  await expect(
    page.getByText("Goals saved. Earlier dates keep their previous targets."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await expect(card("Energy")).toContainText("50%");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}
