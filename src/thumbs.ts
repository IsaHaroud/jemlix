import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { basename, extname, resolve, sep } from "node:path";
import { isImageFileName } from "./product.ts";

const MEDIA = resolve("media");
const THUMBS = resolve("media/thumbs");

export function thumbFileName(filename: string): string {
  return basename(filename, extname(filename)) + ".jpg";
}

function inside(root: string, full: string): boolean {
  return full === root || full.startsWith(root + sep);
}

export function ensureThumb(filename: string): Promise<void> {
  if (!isImageFileName(filename)) return Promise.resolve();
  mkdirSync(THUMBS, { recursive: true });
  const src = resolve(MEDIA, filename);
  const dest = resolve(THUMBS, thumbFileName(filename));
  if (!inside(MEDIA, src) || !inside(THUMBS, dest) || !existsSync(src)) return Promise.resolve();
  if (existsSync(dest)) {
    const srcStat = statSync(src);
    const destStat = statSync(dest);
    if (destStat.isFile() && destStat.size > 0 && destStat.mtimeMs >= srcStat.mtimeMs) return Promise.resolve();
  }

  const tmp = `${dest}.tmp-${process.pid}`;
  return runMagick(src, tmp)
    .then(() => {
      renameSync(tmp, dest);
    })
    .catch((err) => {
      if (existsSync(tmp)) unlinkSync(tmp);
      throw err;
    });
}

function runMagick(src: string, dest: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      "magick",
      [src, "-auto-orient", "-thumbnail", "480x480>", "-strip", "-quality", "75", dest],
      { stdio: "ignore" },
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`magick exited ${code}`));
    });
  });
}

async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  async function next(): Promise<void> {
    while (cursor < items.length) {
      const item = items[cursor]!;
      cursor += 1;
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
}

export async function ensureThumbs(filenames: string[]): Promise<{ ok: number; fail: number }> {
  let ok = 0;
  let fail = 0;
  await pool(filenames, 4, async (name) => {
    try {
      await ensureThumb(name);
      ok += 1;
    } catch (err) {
      fail += 1;
      console.error(`thumb ${name}:`, err instanceof Error ? err.message : err);
    }
  });
  return { ok, fail };
}

if (import.meta.main) {
  const files = readdirSync(MEDIA).filter((name) => isImageFileName(name));
  const result = await ensureThumbs(files);
  console.log(`thumbs ok=${result.ok} fail=${result.fail} total=${files.length}`);
  if (result.fail) process.exit(1);
}
