import { expect, test } from "bun:test";
import { isValidSlug, slugify } from "./slug.ts";

test("slugifies a latin name", () => {
  expect(slugify("The Supplier")).toBe("the-supplier");
  expect(slugify("  Mode   Femme! ")).toBe("mode-femme");
});

test("returns empty for arabic or emoji-only names", () => {
  expect(slugify("متجر الملابس")).toBe("");
  expect(slugify("👗✨")).toBe("");
});

test("validates an admin slug", () => {
  expect(isValidSlug("the-supplier")).toBe(true);
  expect(isValidSlug("the-supplier-2")).toBe(true);
  expect(isValidSlug("The Supplier")).toBe(false);
  expect(isValidSlug("../etc")).toBe(false);
  expect(isValidSlug("")).toBe(false);
});
