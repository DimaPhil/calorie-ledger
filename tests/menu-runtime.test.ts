import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("loads the shared menu in native Node without the test or Vite loaders", () => {
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import("./src/menu-shared.ts").then(m => console.log(m.listMenuRecipes().length))',
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  expect(output.trim()).toBe("22");
});
