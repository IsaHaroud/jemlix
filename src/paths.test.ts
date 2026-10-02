import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { safeChild } from "./paths.ts";

function dir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "jemla-")));
}

test("reads a file inside the root", () => {
  const root = dir();
  writeFileSync(join(root, "a.jpg"), "x");
  expect(safeChild(root, "a.jpg")).toBe(join(root, "a.jpg"));
});

test("rejects parent traversal, including encoded dot-dot", () => {
  const root = dir();
  writeFileSync(join(root, "a.jpg"), "x");
  expect(safeChild(root, "../a.jpg")).toBeNull();
  expect(safeChild(root, "..%2fa.jpg")).toBeNull();
  expect(safeChild(root, "%2e%2e%2fa.jpg")).toBeNull();
});

test("rejects a symlink that leaves the root", () => {
  const root = dir();
  const outside = dir();
  writeFileSync(join(outside, "secret.txt"), "no");
  symlinkSync(outside, join(root, "link"));
  expect(safeChild(root, "link/secret.txt")).toBeNull();
});

test("allows a nested file and rejects a missing one", () => {
  const root = dir();
  mkdirSync(join(root, "thumbs"));
  writeFileSync(join(root, "thumbs", "a.jpg"), "x");
  expect(safeChild(root, "thumbs/a.jpg")).toBe(join(root, "thumbs", "a.jpg"));
  expect(safeChild(root, "missing.jpg")).toBeNull();
});
