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
