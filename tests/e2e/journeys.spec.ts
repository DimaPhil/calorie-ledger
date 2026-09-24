import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
// These journeys intercept requests to simulate failures; service workers can bypass routing.
test.use({ serviceWorkers: "block" });
test("journal detail modal edits component snapshots without changing saved foods", async ({
  page,
}, info) => {
  await page.goto("/");
  await page
    .getByLabel("Username", { exact: true })
    .fill(`tester-${info.project.name}`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("test-password-12345");
  await page.getByRole("button", { name: "Sign in →" }).click();
  await expect(page.locator(".metrics")).toBeVisible();
  const headers = { Origin: "http://127.0.0.1:3100" };
  const product = await (
    await page.request.post("/api/actions/save_product", {
      headers,
      data: {
        product: {
          name: `Modal oats ${info.project.name}`,
          nutrients: { calories: 100, protein: 5 },
        },
      },
    })
  ).json();
  const profile = await (
    await page.request.post("/api/actions/get_profile", { headers, data: {} })
  ).json();
  const logged = await (
    await page.request.post("/api/actions/log_food", {
      headers,
      data: {
        productId: product.id,
        amount: 100,
        unit: "g",
        date: profile.today,
        idempotencyKey: `modal-entry-${info.project.name}`,
      },
    })
  ).json();
  await page.reload();
  const opener = page.getByRole("button", {
    name: `View entry: Modal oats ${info.project.name}`,
    exact: true,
  });
  await opener.focus();
  await opener.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Entry nutrition" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
  await opener.click();
  await dialog.getByRole("button", { name: "Edit entry", exact: true }).click();
  await dialog
    .getByLabel("Entry name", { exact: true })
    .fill(`Corrected meal ${info.project.name}`);
  await dialog.getByLabel("Entry amount", { exact: true }).fill("200");
  await dialog
    .getByRole("button", { name: "Scale components to this amount" })
    .click();
  await expect(
    dialog.getByLabel("Calories (kcal)", { exact: true }),
  ).toHaveValue("200");
  await dialog.getByLabel("Calories (kcal)", { exact: true }).fill("180");
  await dialog
    .getByRole("button", { name: "Add component", exact: true })
    .click();
  const second = dialog.getByRole("group", {
    name: "Component 2",
    exact: true,
  });
  await second.getByLabel("Component name").fill("Extra fruit");
  await second.getByLabel("Component grams").fill("25");
  await second.getByLabel("Calories (kcal)").fill("20");
  await expect(dialog.getByRole("status")).toContainText(
    "Entry total: 200 kcal",
  );
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await expect(page.locator("body")).toHaveJSProperty(
    "scrollWidth",
    await page.locator("body").evaluate((e) => e.clientWidth),
  );
  await page.screenshot({
    path: info.outputPath("entry-editor.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Save correction" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page
      .locator(".entry")
      .filter({ hasText: `Corrected meal ${info.project.name}` })
      .locator(".entry-energy"),
  ).toContainText("200");
  const products = await (
    await page.request.post("/api/actions/list_products", { headers, data: {} })
  ).json();
  expect(
    products.find((p: { id: string }) => p.id === product.id).nutrients
      .calories,
  ).toBe(100);
  await page
    .getByRole("button", {
      name: `View entry: Corrected meal ${info.project.name}`,
      exact: true,
    })
    .click();
  await dialog.getByRole("button", { name: "Edit entry", exact: true }).click();
  await dialog.getByLabel("Entry notes").fill("Keep this draft");
  await page.request.post("/api/actions/update_entry", {
    headers,
    data: {
      id: logged.entry.id,
      date: profile.today,
      meal: "snack",
      notes: "Changed elsewhere",
      expectedRevision: 1,
    },
  });
  await dialog.getByRole("button", { name: "Save correction" }).click();
  await expect(dialog.getByRole("alert")).toContainText("changed elsewhere");
  await expect(dialog.getByLabel("Entry notes")).toHaveValue("Keep this draft");
});
test("OAuth sign-in, consent, callback and revocation", async ({
  page,
}, testInfo) => {
  const origin = "http://127.0.0.1:3100";
  const receiver = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end("<h1>Connected</h1>");
  });
  await new Promise<void>((resolve) =>
    receiver.listen(0, "127.0.0.1", resolve),
  );
  try {
    const callback = `http://127.0.0.1:${(receiver.address() as { port: number }).port}/callback`;
    const verifier = "a".repeat(43);
    const registered = await page.request.post("/register", {
      data: {
        client_name: `Browser connector ${testInfo.project.name}`,
        redirect_uris: [callback],
        token_endpoint_auth_method: "none",
      },
    });
    expect(registered.status()).toBe(201);
    const { client_id } = await registered.json();
    const params = new URLSearchParams({
      client_id,
      redirect_uri: callback,
      response_type: "code",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      resource: `${origin}/mcp`,
      scope: "ledger",
      state: "browser-state",
    });
    await page.goto(`/authorize?${params}`);
    await expect(
      page.getByRole("heading", { name: "Connect Calorie Ledger" }),
    ).toBeVisible();
    await expect(
      page.getByText("read, add, edit, and delete", { exact: false }),
    ).toBeVisible();
    await page
      .getByLabel("Username", { exact: true })
      .fill(`tester-${testInfo.project.name}`);
    await page
      .getByLabel("Password", { exact: true })
      .fill("test-password-12345");
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await expect(page.locator("body")).toHaveJSProperty(
      "scrollWidth",
      await page.locator("body").evaluate((e) => e.clientWidth),
    );
    await page.getByRole("button", { name: "Allow access" }).focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Connected", exact: true }),
    ).toBeVisible();
    const returned = new URL(page.url());
    expect(returned.searchParams.get("state")).toBe("browser-state");
    expect(returned.searchParams.get("iss")).toBe(origin);
    const exchanged = await page.request.post(`${origin}/token`, {
      form: {
        grant_type: "authorization_code",
        client_id,
        code: returned.searchParams.get("code")!,
        code_verifier: verifier,
        redirect_uri: callback,
        resource: `${origin}/mcp`,
      },
    });
    expect(exchanged.status()).toBe(200);
    await page.goto("/");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .locator(".token-list .food-row")
      .filter({ hasText: `OAuth: Browser connector ${testInfo.project.name}` })
      .getByRole("button", { name: "Revoke" })
      .click();
    await expect(
      page.getByText("Token revoked.", { exact: true }),
    ).toBeVisible();
  } finally {
    receiver.closeAllConnections();
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
  }
});
test("food → dish → custom meal → statistics → token lifecycle", async ({
  page,
}, testInfo) => {
  const name = `Oats ${testInfo.project.name}`;
  await page.goto("/");
  await page
    .getByLabel("Username", { exact: true })
    .fill(`tester-${testInfo.project.name}`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("test-password-12345");
  await page.getByRole("button", { name: "Sign in →" }).click();
  await expect(
    page.getByRole("heading", { name: "Your day, on the record." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Foods", exact: true }).click();
  await page.getByRole("button", { name: "＋ Custom food" }).focus();
  await page.getByRole("button", { name: "＋ Custom food" }).press("Enter");
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
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await page.getByLabel("From", { exact: true }).fill("2099-01-02");
  await page.getByLabel("Through", { exact: true }).fill("2099-01-01");
  await expect(page.getByRole("alert")).toContainText("Choose a date range");
  await expect(page.locator(".energy > strong")).toContainText("—");
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.locator(".entries")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
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
test("saved matches can be broadened with the keyboard", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page
    .getByLabel("Username", { exact: true })
    .fill(`tester-${testInfo.project.name}`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("test-password-12345");
  await page.getByRole("button", { name: "Sign in →" }).click();
  await page.getByRole("button", { name: "Foods", exact: true }).click();
  const query = `Oats ${testInfo.project.name}`;
  await page.getByLabel("Search products").fill(query);
  await page.getByRole("button", { name: "Search foods", exact: true }).click();
  const broaden = page.getByRole("button", {
    name: "Search for other matches",
  });
  await expect(broaden).toBeVisible();
  // Editing the input must not silently change the query being expanded.
  await page.getByLabel("Search products").fill("different query");
  await broaden.focus();
  const request = page.waitForRequest("**/api/actions/search_products");
  await page.keyboard.press("Enter");
  expect((await request).postDataJSON()).toEqual({ query, broaden: true });
  await expect(
    page.getByText("External lookup is disabled in automated tests."),
  ).toBeVisible();
  await expect(broaden).toHaveCount(0);
  await expect(page.locator(".search-results")).toContainText(query);
  await expect(page.locator("body")).toHaveJSProperty(
    "scrollWidth",
    await page.locator("body").evaluate((e) => e.clientWidth),
  );
});
test("switching accounts clears products, search results and nutrition totals", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page
    .getByLabel("Username", { exact: true })
    .fill(`tester-${testInfo.project.name}`);
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
  await page
    .getByLabel("Username", { exact: true })
    .fill(`tester-${testInfo.project.name}`);
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
}, testInfo) => {
  await page.goto("/");
  await page
    .getByLabel("Username", { exact: true })
    .fill(`tester-${testInfo.project.name}`);
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
  await page.getByRole("button", { name: "＋ Custom food" }).focus();
  await page.getByRole("button", { name: "＋ Custom food" }).press("Enter");
  await expect(page.getByLabel("Food name", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "＋ Custom food" }),
  ).toBeFocused();
});
