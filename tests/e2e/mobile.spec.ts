import { test, expect } from "@playwright/test";
import express from "express";
import { checkGoals } from "./goals.js";
import { checkProgress } from "./progress.js";

test("phone pages and dialogs fit the viewport", async ({ page }, info) => {
  await page.goto("/");
  await page
    .getByLabel("Username", { exact: true })
    .fill(`tester-${info.project.name}`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("test-password-12345");
  await page.getByRole("button", { name: "Sign in →" }).click();
  await expect(page.locator(".metrics")).toBeVisible();
  for (const tab of ["Journal", "Progress", "Foods", "Dishes", "Settings"]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    for (const width of [320, 390, 430, 621, 744]) {
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await page.screenshot({
    path: info.outputPath("phone-journal.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    )
    .toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "＋ Log food", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    )
    .toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath("phone-dialog.png") });
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Day", exact: true }).click();
  await checkGoals(page, info);
  await checkProgress(page, info);
});

test("Home Screen metadata and private offline fallback", async ({ page }) => {
  // WebKit offline emulation rejects cached responses (Playwright #42775).
  // Drop real connections on a server owned only by this test instead.
  let offline = false;
  const app = express();
  app.use((req, _res, next) => (offline ? req.socket.destroy() : next()));
  app.get("/api/me", (_req, res) => {
    res.status(401).json({ error: "Sign in" });
  });
  app.use(express.static("dist"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await page.goto(origin);
    const manifestUrl = await page
      .locator('link[rel="manifest"]')
      .getAttribute("href");
    const manifest = await (
      await page.request.get(origin + manifestUrl!)
    ).json();
    expect(manifest.display).toBe("standalone");
    for (const icon of manifest.icons) {
      const response = await page.request.get(origin + icon.src);
      expect(response.headers()["content-type"]).toContain("image/png");
    }
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
      .toBe(true);
    const cached = await page.evaluate(async () => {
      const keys = await caches.keys();
      return (
        await Promise.all(
          keys.map(async (key) =>
            (await (await caches.open(key)).keys()).map(
              (request) => new URL(request.url).pathname,
            ),
          ),
        )
      ).flat();
    });
    expect(cached).toEqual(["/offline.html"]);
    offline = true;
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "You’re offline." }),
    ).toBeVisible();
    offline = false;
    await page.getByRole("link", { name: "Try again" }).click();
    await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
