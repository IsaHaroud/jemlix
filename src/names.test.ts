import { expect, test } from "bun:test";
import { isSubstantialName } from "./names.ts";

test("rejects emoji-only and too-short names", () => {
  expect(isSubstantialName("🛍️✨🔥")).toBe(false);
  expect(isSubstantialName("   ")).toBe(false);
  expect(isSubstantialName("أ")).toBe(false);
});

test("accepts arabic and latin product names", () => {
  expect(isSubstantialName("تيشيرت قطن")).toBe(true);
  expect(isSubstantialName("Casque BT")).toBe(true);
});
