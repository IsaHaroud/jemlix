// Keep in sync with src/names.ts
const EMOJI = /\p{Extended_Pictographic}|\uFE0F|\u200D/gu;

export function isSubstantialName(name) {
  const stripped = String(name ?? "").replace(EMOJI, "").replace(/[^\p{L}\p{N}]+/gu, "");
  return stripped.length >= 2;
}

export function displayName(name) {
  const trimmed = String(name ?? "").trim();
  return isSubstantialName(trimmed) ? trimmed : "منتج بدون اسم";
}

export function suggestedName(text) {
  for (const line of String(text ?? "").split("\n")) {
    const trimmed = line.trim().slice(0, 80);
    if (isSubstantialName(trimmed)) return trimmed;
  }
  return "";
}

export function priceLabel(price, currency = "د.م", onRequestLabel = "") {
  const raw = String(price ?? "").trim();
  if (!raw) return onRequestLabel;
  if (/د\.م|درهم|\bDH\b|\bMAD\b/i.test(raw)) return raw;
  return `${raw} ${currency}`;
}

export function mediaUrl(file) {
  return `/media/${encodeURIComponent(file)}`;
}

export function thumbUrl(file) {
  const base = String(file).replace(/\.(jpe?g|png|webp)$/i, "");
  return `/media/thumbs/${encodeURIComponent(`${base}.jpg`)}`;
}

export function safeHttpUrl(href) {
  try {
    const url = new URL(href, location.origin);
    if (url.protocol === "https:" || url.protocol === "http:") return url.href;
  } catch {
    /* not a url */
  }
  return "";
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function firstNumber(value) {
  const m = String(value ?? "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// All unit-price numbers on a product: base price + every tier price.
export function priceNumbers(product) {
  if (product.price_on_request) return [];
  const out = [];
  const base = firstNumber(product.price);
  if (base !== null) out.push(base);
  for (const tier of product.price_tiers || []) {
    const n = firstNumber(tier.price);
    if (n !== null) out.push(n);
  }
  return out;
}

// "62.27 – 64.41 MAD" for tiered products, "" when no tier prices.
export function tierRangeLabel(tiers, currency = "د.م") {
  const nums = [];
  for (const tier of tiers || []) {
    const n = firstNumber(tier.price);
    if (n !== null) nums.push(n);
  }
  if (!nums.length) return "";
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  return lo === hi ? `${lo} ${currency}` : `${lo} – ${hi} ${currency}`;
}

export function tierQtyLabel(tier, andUp = "≥") {
  if (tier.max_qty == null) return `${andUp}${Number(tier.min_qty).toLocaleString("en-US").replace(/,/g, " ")}`;
  if (tier.max_qty === tier.min_qty) return `${Number(tier.min_qty).toLocaleString("en-US").replace(/,/g, " ")}`;
  return `${Number(tier.min_qty).toLocaleString("en-US").replace(/,/g, " ")}–${Number(tier.max_qty).toLocaleString("en-US").replace(/,/g, " ")}`;
}
