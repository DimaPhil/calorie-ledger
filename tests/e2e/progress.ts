import { expect, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { analysisPrompt } from "../../src/analysis-prompt.js";

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
      nutrients: { calories: 1000, protein: 80, fiber: 10, iron: 0 },
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
  const incomplete = await post("save_product", {
    product: {
      name: "Missing fiber",
      nutrients: { calories: 0, protein: 0, iron: 0 },
    },
  });
  await post("log_food", {
    productId: incomplete.id,
    amount: 100,
    unit: "g",
    date: "2026-09-25",
    idempotencyKey: `missing-fiber-${info.project.name}-${info.retry}`,
  });
  await page.getByRole("button", { name: "Progress", exact: true }).click();
  const calories = page
    .locator(".progress-panels > section")
    .filter({ has: page.getByRole("heading", { name: "Calories over days" }) });
  await expect(calories).toContainText("1,500");
  await expect(calories).toContainText("Average from 2 complete days");
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await page.getByLabel("Progress end date").fill("2026-09-25");
  await expect(calories).toContainText("Average from 1 complete days");
  await expect(calories.locator(".progress-big")).toContainText("1,000");
  await expect(page.getByRole("button", { name: /Sep 27:/ })).toHaveCount(0);
  await page.getByLabel("Progress start date").fill("2026-09-26");
  await expect(page.getByRole("alert")).toContainText(
    "end on or after the start",
  );
  await expect(page.locator(".progress-panels")).toHaveCount(0);
  await page.getByLabel("Progress start date").fill("2026-09-24");
  await page.getByLabel("Progress end date").fill("2026-10-01");
  await expect(calories).toContainText("Average from 2 complete days");
  await expect(
    page.getByRole("region", { name: "Check-in consistency" }),
  ).toContainText("38% checked in");
  await expect(page.getByRole("button", { name: /Sep 23:/ })).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const panels = page.locator(".progress-panels > .panel");
  for (const selector of [
    ".progress-big",
    ".progress-figure",
    ".progress-data",
  ]) {
    const first = await panels.nth(0).locator(selector).boundingBox();
    const second = await panels.nth(1).locator(selector).boundingBox();
    expect(Math.abs(first!.y - second!.y)).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: info.outputPath("progress-aligned.png") });
  await page.setViewportSize({ width: 390, height: 844 });
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
  await page.getByRole("button", { name: "Fiber", exact: true }).click();
  const nutrients = page.getByRole("region", { name: "Nutrients over days" });
  await expect(nutrients.locator(".progress-big")).toContainText("15");
  await expect(nutrients).toContainText(
    "2 of 3 logged days have complete nutrient data",
  );
  await expect(nutrients.locator(".progress-bar-partial")).toHaveCount(6);
  await nutrients.locator("summary").click();
  await expect(nutrients.getByRole("row", { name: /Sep 25/ })).toContainText(
    "Missing nutrition",
  );
  await expect(nutrients.getByRole("row", { name: /Sep 25/ })).toContainText(
    "5",
  );
  await expect(nutrients.getByRole("row", { name: /Sep 26/ })).toContainText(
    "0*",
  );
  await expect(nutrients.getByRole("row", { name: /Sep 26/ })).toContainText(
    "Not recorded",
  );
  await nutrients.locator("summary").click();
  const nutrientSelect = page.getByRole("combobox", {
    name: "Nutrient",
    exact: true,
  });
  await expect(nutrientSelect.locator('option[value="sodium"]')).toHaveCount(0);
  await nutrientSelect.selectOption("iron");
  await expect(nutrients.locator(".progress-big")).toContainText("0");
  await page.getByRole("button", { name: "Fiber", exact: true }).click();
  await expect(
    page
      .getByRole("combobox", { name: "Body measurement" })
      .locator('option[value="waist"]'),
  ).toHaveCount(0);
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
  await page.locator(".export-panel > summary").click();
  await page.getByText("AI nutrition analysis prompt", { exact: true }).click();
  const prompt = page.getByLabel("Analysis prompt", { exact: true });
  await expect(prompt).toHaveValue(analysisPrompt);
  await page.getByRole("button", { name: "Copy prompt", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    /Prompt copied|Text selected/,
  );
  // Clipboard denial must leave the full prompt selectable rather than silently fail.
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("Clipboard denied");
        },
      },
    }),
  );
  await page.getByRole("button", { name: "Copy prompt", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Text selected");
  expect(
    await prompt.evaluate(
      (node: HTMLTextAreaElement) => node.selectionEnd - node.selectionStart,
    ),
  ).toBe(analysisPrompt.length);
  for (const [button, extension] of [
    ["Download CSV (.zip)", ".zip"],
    ["Download Markdown", ".md"],
  ]) {
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: button, exact: true }).click();
    const file = await downloaded;
    expect(file.suggestedFilename().endsWith(extension)).toBe(true);
    const bytes = await readFile((await file.path())!);
    if (extension === ".zip")
      expect(bytes.subarray(0, 2).toString()).toBe("PK");
    else {
      expect(bytes.toString().startsWith(analysisPrompt)).toBe(true);
      expect(bytes.toString()).toContain("2026-09-23");
      expect(bytes.toString()).toContain(product.name);
    }
  }
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
