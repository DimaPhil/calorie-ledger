import { describe, it, expect } from "vitest";
import source from "../src/menu-data.json";
import english from "../src/menu-en.json";
import { localizeLabel, localizeError } from "../src/i18n.js";

describe("bilingual interface", () => {
  it("covers every source recipe and its ingredient/step text without duplicating nutrition", () => {
    expect(Object.keys(english.recipes).sort()).toEqual(
      source.recipes.map((recipe) => recipe.id).sort(),
    );
    for (const recipe of source.recipes) {
      const translated =
        english.recipes[recipe.id as keyof typeof english.recipes];
      expect(translated.ing).toHaveLength(recipe.ing.length);
      expect(translated.steps).toHaveLength(recipe.steps.length);
      expect(translated.tips).toHaveLength(recipe.tips.length);
      expect(translated.vary).toHaveLength(recipe.vary.length);
      expect(JSON.stringify(translated)).not.toMatch(/[А-Яа-яЁё]/);
      expect(translated).not.toHaveProperty("macros");
    }
    expect(Object.keys(english.shopping).sort()).toEqual(
      Object.keys(source.shopping).sort(),
    );
  });
  it("translates labels and units while preserving English and unknown user text", () => {
    expect(localizeLabel("Protein (g)", "ru")).toBe("Белок (г)");
    expect(localizeLabel("saturatedFat", "ru")).toBe("Насыщенные жиры");
    expect(localizeLabel("serving", "en")).toBe("serving");
    expect(localizeLabel("My food", "ru")).toBe("My food");
  });
  it("preserves actionable error details and product names", () => {
    expect(
      localizeError(
        "Add calories per 100g for Costco rice before logging.",
        "ru",
      ),
    ).toContain("Costco rice");
    expect(
      localizeError(
        "Choose a date range of up to 366 days, with the end on or after the start.",
        "ru",
      ),
    ).toContain("366");
    expect(localizeError("Unrecognized detail", "ru")).toBe(
      "Unrecognized detail",
    );
  });
});
