import { isValidSlug } from "./slug.ts";

export const SUPPLIER_STATUS = new Set(["pending", "active", "paused"]);
export const SUBMISSION_STATUS = new Set(["new", "published", "skipped"]);

function text(value: unknown, max: number): string | null {
  if (value == null) return "";
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length > max) return null;
  return trimmed;
}

export function normalizeWhatsapp(raw: string): string {
  const v = raw.trim().replace(/[\s()-]/g, "");
  if (!v) return "";
  if (/^0[5-7]\d{8}$/.test(v)) return `+212${v.slice(1)}`;
  if (/^212[5-7]\d{8}$/.test(v)) return `+${v}`;
  return v;
}

export function whatsappOk(value: string): boolean {
  return /^\+?\d{8,15}$/.test(value);
}

export type SupplierCreate = {
  name: string;
  username: string;
  whatsapp: string;
  telegram_id: number | null;
  channel_slug: string;
  status: string;
};

export function parseSupplierCreate(input: unknown): { ok: true; value: SupplierCreate } | { ok: false; error: string } {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "JSON غير صالح" };
  }
  const body = input as Record<string, unknown>;
  const name = text(body.name, 120);
  const username = text(body.username, 80);
  const whatsappRaw = text(body.whatsapp, 32);
  const slug = text(body.channel_slug, 80);
  const statusRaw = text(body.status, 16);
  if (name == null || username == null || whatsappRaw == null || slug == null || statusRaw == null) {
    return { ok: false, error: "حقل غير صالح" };
  }
  const status = statusRaw || "pending";
  if (!SUPPLIER_STATUS.has(status)) return { ok: false, error: "الحالة غير معروفة" };
  if (slug && !isValidSlug(slug)) return { ok: false, error: "السيلغ غير صالح" };
  const whatsapp = whatsappRaw ? normalizeWhatsapp(whatsappRaw) : "";
  if (whatsapp && !whatsappOk(whatsapp)) return { ok: false, error: "رقم واتساب غير صالح" };
  let telegram_id: number | null = null;
  if (body.telegram_id != null && body.telegram_id !== "") {
    const n = Number(body.telegram_id);
    if (!Number.isInteger(n) || n <= 0) return { ok: false, error: "معرف تيليغرام غير صالح" };
    telegram_id = n;
  }
  return { ok: true, value: { name, username: username.replace(/^@/, ""), whatsapp, telegram_id, channel_slug: slug, status } };
}

export type SupplierPatch = {
  name?: string;
  username?: string;
  whatsapp?: string;
  telegram_id?: number | null;
  channel_id?: string;
  channel_title?: string;
  channel_slug?: string;
  status?: string;
};

export function parseSupplierPatch(input: unknown): { ok: true; value: SupplierPatch } | { ok: false; error: string } {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "JSON غير صالح" };
  }
  const body = input as Record<string, unknown>;
  const out: SupplierPatch = {};
  if (body.name !== undefined) {
    const v = text(body.name, 120);
    if (v == null) return { ok: false, error: "الاسم غير صالح" };
    out.name = v;
  }
  if (body.username !== undefined) {
    const v = text(body.username, 80);
    if (v == null) return { ok: false, error: "اسم المستخدم غير صالح" };
    out.username = v.replace(/^@/, "");
  }
  if (body.whatsapp !== undefined) {
    const v = text(body.whatsapp, 32);
    if (v == null) return { ok: false, error: "رقم واتساب غير صالح" };
    const norm = v ? normalizeWhatsapp(v) : "";
    if (norm && !whatsappOk(norm)) return { ok: false, error: "رقم واتساب غير صالح" };
    out.whatsapp = norm;
  }
  if (body.telegram_id !== undefined) {
    if (body.telegram_id === null || body.telegram_id === "") out.telegram_id = null;
    else {
      const n = Number(body.telegram_id);
      if (!Number.isInteger(n) || n <= 0) return { ok: false, error: "معرف تيليغرام غير صالح" };
      out.telegram_id = n;
    }
  }
  if (body.channel_id !== undefined) {
    const v = text(body.channel_id, 64);
    if (v == null) return { ok: false, error: "معرف القناة غير صالح" };
    if (v && !/^-\d{6,20}$/.test(v)) return { ok: false, error: "معرف القناة خاصو يكون رقما سالبا بحال -1001234567890" };
    out.channel_id = v;
  }
  if (body.channel_title !== undefined) {
    const v = text(body.channel_title, 160);
    if (v == null) return { ok: false, error: "اسم القناة غير صالح" };
    out.channel_title = v;
  }
  if (body.channel_slug !== undefined) {
    const v = text(body.channel_slug, 80);
    if (v == null) return { ok: false, error: "السيلغ غير صالح" };
    if (v && !isValidSlug(v)) return { ok: false, error: "السيلغ غير صالح" };
    out.channel_slug = v;
  }
  if (body.status !== undefined) {
    const v = text(body.status, 16);
    if (v == null || !SUPPLIER_STATUS.has(v)) return { ok: false, error: "الحالة غير معروفة" };
    out.status = v;
  }
  if (Object.keys(out).length === 0) return { ok: false, error: "لا شيء للتحديث" };
  return { ok: true, value: out };
}

export type SubmissionCreate = {
  supplier_id: number;
  tg_message_id: number | null;
  text: string;
  image: string;
};

export function parseSubmissionCreate(
  input: unknown,
  opts: { imageOk?: (name: string) => boolean } = {},
): { ok: true; value: SubmissionCreate } | { ok: false; error: string } {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "JSON غير صالح" };
  }
  const body = input as Record<string, unknown>;
  const supplier_id = Number(body.supplier_id);
  if (!Number.isInteger(supplier_id) || supplier_id <= 0) return { ok: false, error: "المورّد غير صالح" };
  const textV = text(body.text, 4000);
  if (textV == null) return { ok: false, error: "النص غير صالح" };
  const image = text(body.image, 160) ?? "";
  if (!textV && !image) return { ok: false, error: "أضف نصا أو صورة" };
  if (image && opts.imageOk && !opts.imageOk(image)) return { ok: false, error: "الصورة غير صالحة" };
  let tg_message_id: number | null = null;
  if (body.tg_message_id != null && body.tg_message_id !== "") {
    const n = Number(body.tg_message_id);
    if (!Number.isInteger(n) || n <= 0) return { ok: false, error: "معرف الرسالة غير صالح" };
    tg_message_id = n;
  }
  return { ok: true, value: { supplier_id, tg_message_id, text: textV, image } };
}

export type SupplierProductPatch = {
  price?: string;
  price_on_request?: boolean;
  stock?: string;
  moq?: string;
  description?: string;
  published?: boolean;
};

// Supplier portal intentionally exposes only routine commercial fields.
// Names, categories, images, contacts and ownership remain admin-controlled.
export function parseSupplierProductPatch(
  input: unknown,
): { ok: true; value: SupplierProductPatch } | { ok: false; error: string } {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "JSON غير صالح" };
  }
  const body = input as Record<string, unknown>;
  const out: SupplierProductPatch = {};
  for (const [key, max] of [["price", 40], ["stock", 80], ["moq", 40], ["description", 4000]] as const) {
    if (body[key] === undefined) continue;
    const value = text(body[key], max);
    if (value == null) return { ok: false, error: "قيمة غير صالحة" };
    out[key] = value;
  }
  if (body.price_on_request !== undefined) {
    if (typeof body.price_on_request !== "boolean") return { ok: false, error: "الثمن عند الطلب غير صالح" };
    out.price_on_request = body.price_on_request;
  }
  if (body.published !== undefined) {
    if (typeof body.published !== "boolean") return { ok: false, error: "الحالة غير صالحة" };
    out.published = body.published;
  }
  if (Object.keys(out).length === 0) return { ok: false, error: "لا شيء للتحديث" };
  return { ok: true, value: out };
}
