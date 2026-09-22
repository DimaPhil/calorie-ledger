import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["server/**/*.ts"],
      exclude: ["server/dev.ts"],
      reporter: ["text", "html", "lcov"],
      thresholds: { lines: 90, statements: 90, branches: 80, functions: 90 },
    },
  },
});
