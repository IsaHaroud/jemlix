import { existsSync, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

// Resolve `rel` against `root` and return the real file path only when it
// stays inside `root`. Rejects traversal, absolute paths, and symlinks that
// point outside the root.
export function safeChild(root: string, rel: string): string | null {
  if (!rel || rel.includes("\0")) return null;
  let decoded = rel;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return null;
  }
  if (!decoded || decoded.includes("\0")) return null;
  if (decoded.startsWith("/") || decoded.startsWith("\\")) return null;
  if (/^[a-zA-Z]:/.test(decoded)) return null;

  const rootAbs = resolve(root);
  const rootReal = existsSync(rootAbs) ? realpathSync(rootAbs) : rootAbs;
  const full = resolve(rootReal, decoded);
  if (full !== rootReal && !full.startsWith(rootReal + sep)) return null;
  if (!existsSync(full)) return null;

  const real = realpathSync(full);
  if (real !== rootReal && !real.startsWith(rootReal + sep)) return null;
  if (!statSync(real).isFile()) return null;
  return real;
}
