import { isSubstantialName } from "./names.ts";

const IMAGE_NAME = /^[A-Za-z0-9_@+-]+\.(?:jpe?g|png|webp)$/;
const CONTACT_TYPES = new Set(["whatsapp", "whatsapp-msg", "telegram", "none"]);

export type ProductInput = {
  name: string;
  category: string;
  price: string;
  priceOnRequest: boolean;
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

export function parseProduct(
  input: unknown,
  opts: { categories: readonly string[]; imageOk: (name: string) => boolean },
  mode: PublishMode = "publish",
): { ok: true; value: ProductInput } | { ok: false; error: string } {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "JSON غير صالح" };
  }
  const body = input as Record<string, unknown>;
  const draft = mode === "draft";

  const name = text(body.name, 120);
  if (name == null || !isSubstantialName(name)) return { ok: false, error: "اسم المنتج غير كافٍ" };

  const category = text(body.category, 80);
  if (category == null) return { ok: false, error: "الفئة غير صالحة" };
  if (!draft) {
    if (!category) return { ok: false, error: "الفئة إجبارية" };
    if (!opts.categories.includes(category)) return { ok: false, error: "الفئة غير معروفة" };
  } else if (category && !opts.categories.includes(category)) {
    return { ok: false, error: "الفئة غير معروفة" };
  }

  const price = text(body.price, 40);
  const priceOnRequest = body.price_on_request === true || body.price_on_request === 1;
  const stock = text(body.stock, 80);
  const moq = text(body.moq, 40);
  const description = text(body.description, 4000);
  if (price == null || stock == null || moq == null || description == null) {
    return { ok: false, error: "حقل نصي غير صالح" };
  }
  if (!draft) {
    if (!price && !priceOnRequest) return { ok: false, error: "الثمن إجباري (أو اختر الثمن عند الطلب)" };
    if (!moq) return { ok: false, error: "الحد الأدنى إجباري" };
  }

  const rawImages = body.images ?? (draft ? [] : undefined);
  if (!Array.isArray(rawImages) || rawImages.length > 12) {
    return { ok: false, error: "الصور غير صالحة" };
  }
  const images: string[] = [];
  for (const img of rawImages) {
    if (typeof img !== "string" || !isImageFileName(img) || !opts.imageOk(img)) {
      return { ok: false, error: "الصور غير صالحة" };
    }
    if (!images.includes(img)) images.push(img);
  }
  if (!draft && images.length === 0) return { ok: false, error: "صورة واحدة على الأقل إجبارية" };

  const contactType = text(body.contact_type, 32);
  if (contactType == null || !CONTACT_TYPES.has(contactType)) {
    return { ok: false, error: "نوع التواصل غير معروف" };
  }
  if (!draft && contactType === "none") return { ok: false, error: "طريقة التواصل إجبارية" };

  const contactRaw = text(body.contact, 200);
  const sourceChannel = text(body.source_channel, 160);
  if (contactRaw == null || sourceChannel == null) return { ok: false, error: "حقل نصي غير صالح" };

  let contact = contactType === "none" ? "" : contactRaw;
  if (contactType === "whatsapp" || contactType === "whatsapp-msg") {
    if (!whatsappOk(contact)) return { ok: false, error: "رقم واتساب غير صالح" };
  }
  if (contactType === "telegram") {
    try {
      const url = new URL(contact);
      if (url.protocol !== "https:") return { ok: false, error: "رابط تيليغرام غير صالح" };
      contact = url.toString();
    } catch {
      return { ok: false, error: "رابط تيليغرام غير صالح" };
    }
  }

  const postIds: number[] = [];
  if (body.post_ids != null) {
    if (!Array.isArray(body.post_ids) || body.post_ids.length > 50) {
      return { ok: false, error: "البوسطات غير صالحة" };
    }
    for (const id of body.post_ids) {
      if (typeof id !== "number" || !Number.isInteger(id) || id < 1) {
        return { ok: false, error: "البوسطات غير صالحة" };
      }
      if (!postIds.includes(id)) postIds.push(id);
    }
  }

  const specs: { k: string; v: string }[] = [];
  if (body.specs != null) {
    if (!Array.isArray(body.specs) || body.specs.length > 30) {
      return { ok: false, error: "المواصفات غير صالحة" };
    }
    for (const raw of body.specs) {
      if (raw == null || typeof raw !== "object") return { ok: false, error: "المواصفات غير صالحة" };
      const k = text((raw as any).k, 80);
      const v = text((raw as any).v, 400);
      if (k == null || v == null) return { ok: false, error: "المواصفات غير صالحة" };
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
