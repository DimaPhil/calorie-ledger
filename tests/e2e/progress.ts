import { expect, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

export async function checkProgress(page: Page, info: TestInfo) {
  await page.clock.setFixedTime(new Date("2026-10-01T19:00:00Z"));
  const post = async (name: string, data: unknown) => {
    const response = await page.request.post(`/api/actions/${name}`, {
      headers: { Origin: "http://127.0.0.1:3100" },
      data,
    });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const product = await post("save_product", {
    product: {
      name: `Progress ${info.project.name}`,
      nutrients: { calories: 1000, protein: 80 },
    },
  });
  // Other journeys share this isolated test account and may have logged today.
  const existing = await post("get_stats", {
    start: "2026-09-24",
    end: "2026-10-01",
  });
  for (const entry of existing.entries)
    await post("delete_entry", { id: entry.id });
  for (const [date, amount, complete, weight] of [
    ["2026-09-23", 900, true, 99],
    ["2026-09-24", 100, true, 95],
    ["2026-09-25", 50, false, 94.8],
    ["2026-09-27", 200, true, 94.7],
  ] as const) {
    await post("log_food", {
      productId: product.id,
      amount,
      unit: "g",
      date,
      idempotencyKey: `progress-${date}-${info.project.name}-${info.retry}`,
    });
    await post("save_checkin", {
      date,
      complete,
      weight,
      sleep: 7,
      beverages: 2000,
    });
  }
  await page.getByRole("button", { name: "Progress", exact: true }).click();
  const calories = page
    .locator(".progress-panels > section")
    .filter({ has: page.getByRole("heading", { name: "Calories over days" }) });
  await expect(calories).toContainText("1,500");
  await expect(calories).toContainText("Average from 2 complete days");
  await expect(
    page.getByRole("region", { name: "Check-in consistency" }),
  ).toContainText("38% checked in");
  await expect(page.getByRole("button", { name: /Sep 23:/ })).toHaveCount(0);
  await calories.locator("summary").click();
  await expect(calories.getByRole("row", { name: /Sep 25/ })).toContainText(
    "In progress",
  );
  await expect(calories.getByRole("row", { name: /Sep 24/ })).toContainText(
    "2,200",
  );
  await expect(calories.getByRole("row", { name: /Sep 26/ })).toContainText(
    "Not recorded",
  );
  await page
    .getByRole("combobox", { name: "Nutrient", exact: true })
    .selectOption("fiber");
  await expect(page.getByText("No fiber recorded yet.")).toBeVisible();
  await page
    .getByRole("combobox", { name: "Body measurement" })
    .selectOption("waist");
  await expect(page.getByText("No waist recorded yet.")).toBeVisible();
  await page
    .getByRole("combobox", { name: "Body measurement" })
    .selectOption("weight");
  await page
    .getByRole("combobox", { name: "Daily rhythm metric" })
    .selectOption("beverages");
  await expect(page.getByRole("img", { name: /Drinks, / })).toBeVisible();
  await page.getByRole("button", { name: "7 days", exact: true }).click();
  await expect(calories).toContainText("Average from 1 complete days");
  await expect(page.getByRole("button", { name: /Sep 24:/ })).toHaveCount(0);
  await page.getByRole("button", { name: "90 days", exact: true }).click();
  await expect(calories).toContainText("Average from 2 complete days");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: info.outputPath("phone-progress.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", {
      name: "Sep 24: checked in, food day complete",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Journal date", { exact: true })).toHaveValue(
    "2026-09-24",
  );
}
