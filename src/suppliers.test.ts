import { describe, expect, test } from "bun:test";
import { parseSubmissionCreate, parseSupplierCreate, parseSupplierPatch, parseSupplierProductPatch } from "./suppliers.ts";

describe("suppliers", () => {
  test("creates a pending supplier with normalized whatsapp", () => {
    const r = parseSupplierCreate({ name: "سعيد", whatsapp: "0612345678", status: "" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.whatsapp).toBe("+212612345678");
      expect(r.value.status).toBe("pending");
    }
  });

  test("rejects bad slug, bad status, bad whatsapp", () => {
    expect(parseSupplierCreate({ name: "x", channel_slug: "BAD SLUG" }).ok).toBe(false);
    expect(parseSupplierCreate({ name: "x", status: "gold" }).ok).toBe(false);
    expect(parseSupplierCreate({ name: "x", whatsapp: "abc" }).ok).toBe(false);
  });

  test("patch accepts partial fields", () => {
    const r = parseSupplierPatch({ status: "paused", whatsapp: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("paused");
    expect(parseSupplierPatch({}).ok).toBe(false);
    expect(parseSupplierPatch({ status: "nope" }).ok).toBe(false);
    expect(parseSupplierPatch({ channel_id: "-1001234567890", channel_title: "قناة المورد" }).ok).toBe(true);
    expect(parseSupplierPatch({ channel_id: "@not-a-numeric-id" }).ok).toBe(false);
  });

  test("submission needs supplier + text or image", () => {
    expect(parseSubmissionCreate({ supplier_id: 1, text: "hello" }).ok).toBe(true);
    expect(parseSubmissionCreate({ supplier_id: 0, text: "hello" }).ok).toBe(false);
    expect(parseSubmissionCreate({ supplier_id: 1, text: "", image: "" }).ok).toBe(false);
  });

  test("supplier product edits expose only routine commercial fields", () => {
    expect(parseSupplierProductPatch({ price: "49", stock: "متوفر", moq: "10", published: false }).ok).toBe(true);
    expect(parseSupplierProductPatch({ name: "new owner-controlled name" }).ok).toBe(false);
    expect(parseSupplierProductPatch({ published: 1 }).ok).toBe(false);
  });
});
