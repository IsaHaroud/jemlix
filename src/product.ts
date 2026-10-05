import { isSubstantialName } from "./names.ts";

const IMAGE_NAME = /^[A-Za-z0-9_@+-]+\.(?:jpe?g|png|webp)$/;
const CONTACT_TYPES = new Set(["whatsapp", "whatsapp-msg", "telegram", "none"]);

export type PriceTier = { min_qty: number; max_qty: number | null; price: string };

export type ProductInput = {
  name: string;
  category: string;
  price: string;
  priceOnRequest: boolean;
  priceTiers: PriceTier[];
  stock: string;
  moq: string;
  description: string;
  images: string[];
  contact: string;
  contactType: string;
  sourceChannel: string;
  postIds: number[];
  specs: { k: string; v: string }[];
};

export type PublishMode = "publish" | "draft";

export function isImageFileName(name: string): boolean {
  return IMAGE_NAME.test(name);
}

function text(value: unknown, max: number): string | null {
  if (value == null) return "";
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length > max) return null;
  return trimmed;
}

function whatsappOk(value: string): boolean {
  const digits = value.replace(/[\s()-]/g, "");
  return /^\+?\d{8,15}$/.test(digits);
}

export function parsePriceTiers(
  input: unknown,
): { ok: true; value: PriceTier[] } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length > 10) {
    return { ok: false, error: "Invalid price tiers" };
  }
  const priceTiers: PriceTier[] = [];
  for (const raw of input) {
    if (raw == null || typeof raw !== "object") return { ok: false, error: "Invalid price tiers" };
    const t = raw as Record<string, unknown>;
    const minQty = typeof t.min_qty === "number" ? t.min_qty : Number(t.min_qty);
    const maxRaw = t.max_qty;
    const maxQty = maxRaw == null || maxRaw === "" ? null : Number(maxRaw);
    const tierPrice = text(t.price, 40);
    const allBlank = (t.min_qty == null || t.min_qty === "") && (maxRaw == null || maxRaw === "") && !tierPrice;
    if (allBlank) continue;
    if (tierPrice == null) return { ok: false, error: "Invalid price tiers" };
    if (!Number.isInteger(minQty) || minQty < 1) return { ok: false, error: "Tier quantity must be 1 or more" };
    if (maxQty !== null && (!Number.isInteger(maxQty) || maxQty <= minQty)) {
      return { ok: false, error: "Tier max must be above its min" };
    }
    if (!tierPrice || !/\d/.test(tierPrice)) return { ok: false, error: "Tier price must contain a number" };
    priceTiers.push({ min_qty: minQty, max_qty: maxQty, price: tierPrice });
  }
  priceTiers.sort((a, b) => a.min_qty - b.min_qty);
  for (let i = 1; i < priceTiers.length; i++) {
    const prev = priceTiers[i - 1]!;
    if (prev.max_qty === null || priceTiers[i]!.min_qty <= prev.max_qty) {
      return { ok: false, error: "Price tiers must not overlap" };
    }
  }
  return { ok: true, value: priceTiers };
}

export function parseProduct(
  input: unknown,
  opts: { categories: readonly string[]; imageOk: (name: string) => boolean },
  mode: PublishMode = "publish",
): { ok: true; value: ProductInput } | { ok: false; error: string } {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Invalid JSON" };
  }
  const body = input as Record<string, unknown>;
  const draft = mode === "draft";

  const name = text(body.name, 120);
  if (name == null || !isSubstantialName(name)) return { ok: false, error: "Product name is required (2+ letters/numbers)" };

  const category = text(body.category, 80);
  if (category == null) return { ok: false, error: "Invalid category" };
  if (!draft) {
    if (!category) return { ok: false, error: "Category is required" };
    if (!opts.categories.includes(category)) return { ok: false, error: "Unknown category" };
  } else if (category && !opts.categories.includes(category)) {
    return { ok: false, error: "Unknown category" };
  }

  const price = text(body.price, 40);
  const priceOnRequest = body.price_on_request === true || body.price_on_request === 1;
  const stock = text(body.stock, 80);
  const moq = text(body.moq, 40);
  const description = text(body.description, 4000);
  if (price == null || stock == null || moq == null || description == null) {
    return { ok: false, error: "Invalid text field" };
  }
  if (!draft) {
    if (!price && !priceOnRequest) return { ok: false, error: "Price is required (or select price on request)" };
    if (!moq) return { ok: false, error: "MOQ is required" };
  }

  let priceTiers: PriceTier[] = [];
  if (body.price_tiers != null) {
    const tiers = parsePriceTiers(body.price_tiers);
    if (!tiers.ok) return tiers;
    priceTiers = tiers.value;
  }

  const rawImages = body.images ?? (draft ? [] : undefined);
  if (!Array.isArray(rawImages) || rawImages.length > 12) {
    return { ok: false, error: "Invalid images" };
  }
  const images: string[] = [];
  for (const img of rawImages) {
    if (typeof img !== "string" || !isImageFileName(img) || !opts.imageOk(img)) {
      return { ok: false, error: "Invalid images" };
    }
    if (!images.includes(img)) images.push(img);
  }
  if (!draft && images.length === 0) return { ok: false, error: "At least one image is required" };

  const contactType = text(body.contact_type, 32);
  if (contactType == null || !CONTACT_TYPES.has(contactType)) {
    return { ok: false, error: "Unknown contact type" };
  }
  if (!draft && contactType === "none") return { ok: false, error: "A contact method is required" };

  const contactRaw = text(body.contact, 200);
  const sourceChannel = text(body.source_channel, 160);
  if (contactRaw == null || sourceChannel == null) return { ok: false, error: "Invalid text field" };

  let contact = contactType === "none" ? "" : contactRaw;
  if (contactType === "whatsapp" || contactType === "whatsapp-msg") {
    if (!whatsappOk(contact)) return { ok: false, error: "Invalid WhatsApp number" };
  }
  if (contactType === "telegram") {
    try {
      const url = new URL(contact);
      if (url.protocol !== "https:") return { ok: false, error: "Invalid Telegram link" };
      contact = url.toString();
    } catch {
      return { ok: false, error: "Invalid Telegram link" };
    }
  }

  const postIds: number[] = [];
  if (body.post_ids != null) {
    if (!Array.isArray(body.post_ids) || body.post_ids.length > 50) {
      return { ok: false, error: "Invalid posts" };
    }
    for (const id of body.post_ids) {
      if (typeof id !== "number" || !Number.isInteger(id) || id < 1) {
        return { ok: false, error: "Invalid posts" };
      }
      if (!postIds.includes(id)) postIds.push(id);
    }
  }

  if (priceOnRequest && priceTiers.length > 0) {
    return { ok: false, error: "Price on request cannot have price tiers" };
  }

  const specs: { k: string; v: string }[] = [];
  if (body.specs != null) {
    if (!Array.isArray(body.specs) || body.specs.length > 30) {
      return { ok: false, error: "Invalid specs" };
    }
    for (const raw of body.specs) {
      if (raw == null || typeof raw !== "object") return { ok: false, error: "Invalid specs" };
      const k = text((raw as any).k, 80);
      const v = text((raw as any).v, 400);
      if (k == null || v == null) return { ok: false, error: "Invalid specs" };
      if (!k || !v) continue;
      specs.push({ k, v });
    }
  }

  return {
    ok: true,
    value: {
      name,
      category,
      price,
      priceOnRequest,
      priceTiers,
      stock,
      moq,
      description,
      images,
      contact,
      contactType,
      sourceChannel,
      postIds,
      specs,
    },
  };
}
