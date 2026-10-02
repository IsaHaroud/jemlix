// Keep in sync with public/format.js
const EMOJI = /\p{Extended_Pictographic}|\uFE0F|\u200D/gu;

export const NAME_FALLBACK = "منتج بدون اسم";

export function isSubstantialName(name: string): boolean {
  const stripped = name.replace(EMOJI, "").replace(/[^\p{L}\p{N}]+/gu, "");
  return stripped.length >= 2;
}
