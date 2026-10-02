import { expect, test } from "bun:test";
import { parseProduct } from "./product.ts";

const categories = ["حقائب", "أخرى"];
const imageOk = (name: string) => name === "194_photo_1@26-07-2026_23-58-26.jpg";
const IMG = "194_photo_1@26-07-2026_23-58-26.jpg";

function parse(body: unknown, mode: "publish" | "draft" = "publish") {
  return parseProduct(body, { categories, imageOk }, mode);
}

function complete(over: Record<string, unknown> = {}) {
  return {
    name: "حقيبة جلد",
    category: "حقائب",
    price: "45",
    stock: "100",
    moq: "10",
    description: "وصف",
    images: [IMG],
    contact: "+212600000000",
    contact_type: "whatsapp",
    source_channel: "The Supplier",
    post_ids: [3, 3, 4],
    ...over,
  };
}

test("rejects an emoji-only name, an unknown category, and a path-like image", () => {
  expect(parse({ name: "🛍️✨🔥", contact_type: "none" }).ok).toBe(false);
  expect(parse({ name: "حقيبة", category: "لا توجد", contact_type: "none" }).ok).toBe(false);
  const slashed = parse({
    name: "حقيبة جلد",
    contact_type: "none",
    images: ["../package.json"],
  });
  expect(slashed.ok).toBe(false);
});

test("accepts a complete product and keeps post ids", () => {
  const result = parse(complete());
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.postIds).toEqual([3, 4]);
  expect(result.value.images).toEqual([IMG]);
  expect(result.value.priceOnRequest).toBe(false);
});

test("publish requires images, category, price, moq and a contact method", () => {
  expect(parse(complete({ images: [] })).ok).toBe(false);
  expect(parse(complete({ category: "" })).ok).toBe(false);
  expect(parse(complete({ price: "" })).ok).toBe(false);
  expect(parse(complete({ moq: "" })).ok).toBe(false);
  expect(parse(complete({ contact_type: "none" })).ok).toBe(false);
});

test("price_on_request replaces the price on publish", () => {
  const result = parse(complete({ price: "", price_on_request: true }));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.priceOnRequest).toBe(true);
});

test("draft allows incomplete commercial fields but still needs a name", () => {
  const result = parse({ name: "فكرة منتج", contact_type: "none" }, "draft");
  expect(result.ok).toBe(true);
  expect(parse({ name: "🛍️✨🔥", contact_type: "none" }, "draft").ok).toBe(false);
});
