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
      nutrients: { calories: 1050, protein: 80, freeSugar: 30, magnesium: 200 },
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
  await expect(card("Free sugars")).toContainText("120%");
  await expect(card("Free sugars")).toContainText("Above limit");
  await expect(card("Fiber")).toContainText("Not tracked");
  await page.locator(".daily-checkin summary").click();
  await page.getByLabel("Drinks total (ml)", { exact: true }).fill("1250");
  await page.getByLabel("Weight (kg)", { exact: true }).fill("95");
  await page.getByLabel("I have finished logging this day").check();
  await page
    .getByRole("button", { name: "Save check-in", exact: true })
    .click();
  await expect(card("Drinks")).toContainText("50%");
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(
    page.getByText("1 / 7 days complete", { exact: true }),
  ).toBeVisible();
  await expect(card("Energy")).toContainText("50%");
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
