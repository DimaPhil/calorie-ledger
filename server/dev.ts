import express from "express";
import { createServer } from "vite";
import { createApp } from "./app.js";
import { testDatabase, db } from "./db.js";
import { createUser } from "./auth.js";
const testing = process.env.E2E_TEST === "1";
if (testing && process.env.NODE_ENV === "production")
  throw new Error("Test mode is forbidden in production.");
const database = testing ? await testDatabase() : db();
if (testing) {
  for (const browser of ["chromium", "mobile", "safari"])
    await createUser(database, `tester-${browser}`, "test-password-12345");
  await createUser(database, "other", "other-password-12345");
}
const app = createApp(
  database,
  testing
    ? async () => ({
        products: [],
        warnings: ["External lookup is disabled in automated tests."],
      })
    : undefined,
);
if (process.env.SERVE_BUILD === "1") {
  app.use(express.static("dist"));
  app.get("/{*path}", (_req, res) =>
    res.sendFile("index.html", { root: "dist" }),
  );
} else {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
app.listen(Number(process.env.PORT || 3000), "127.0.0.1", () =>
  console.log(
    "Calorie Ledger ready on http://127.0.0.1:" + (process.env.PORT || 3000),
  ),
);
