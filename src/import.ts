import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import db from "./db.ts";
import { ensureThumbs } from "./thumbs.ts";
import { slugify } from "./slug.ts";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const dirArg = args.find((arg) => !arg.startsWith("--"));
const supplierArg = (() => {
  const i = args.findIndex((a) => a === "--supplier");
  return i >= 0 ? Number(args[i + 1]) : 0;
})();
const exportDir = dirArg || process.env.EXPORT_DIR || "";

if (!exportDir) {
  console.error("Pass the Telegram export folder: bun run import -- /path/to/ChatExport [--supplier <id>]");
  process.exit(1);
}
if (args.includes("--supplier") && (!Number.isInteger(supplierArg) || supplierArg <= 0)) {
  console.error("Bad --supplier <id>");
  process.exit(1);
}

let supplier: any = null;
if (supplierArg) {
  supplier = db.query(`SELECT * FROM suppliers WHERE id = ?`).get(supplierArg);
  if (!supplier) {
    console.error(`Supplier #${supplierArg} not found`);
    process.exit(1);
  }
  console.log(`Supplier: #${supplier.id} ${supplier.name || ""} (${supplier.status})`);
}

const resultPath = join(exportDir, "result.json");
const mediaOut = "media";

function textOf(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => (typeof part === "string" ? part : (part as { text?: string })?.text ?? ""))
      .join("");
  }
  return "";
}

function extractPhones(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /(?:\+212|0)\s*[5-7](?:\s*\d){8}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const raw = match[0].replace(/\s+/g, "");
    const norm = raw.startsWith("0") ? `+212${raw.slice(1)}` : raw.startsWith("212") ? `+${raw}` : raw;
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

const raw = JSON.parse(readFileSync(resultPath, "utf8")) as { name?: string; id?: number; messages?: unknown[] };
const channelName = raw.name ?? "(unknown)";
const channelId = raw.id ?? 0;
const messages = raw.messages ?? [];
console.log(`Channel: ${channelName} | total messages: ${messages.length}`);

// Upsert the channel with a default slug (admin can override later).
if (!dry) {
  let slug = slugify(channelName);
  if (!slug) slug = `c-${channelId}`;
  const taken = db.query(`SELECT name FROM channels WHERE slug = ? AND name != ?`).get(slug, channelName);
  if (taken) slug = `${slug}-${channelId}`;
  db.query(`INSERT INTO channels (name, slug) VALUES (?, ?) ON CONFLICT(name) DO NOTHING`).run(channelName, slug);
}

let withPhoto = 0;
let withText = 0;
const copied: string[] = [];

const insert = db.query(
  `INSERT INTO posts (msg_id, date, channel, text, image, phone, status, supplier_id) VALUES (?, ?, ?, ?, ?, ?, 'new', ?)
   ON CONFLICT(channel, msg_id) DO UPDATE SET
     date = excluded.date,
     text = excluded.text,
     image = excluded.image,
     phone = excluded.phone,
     supplier_id = COALESCE(posts.supplier_id, excluded.supplier_id)`,
);
if (!dry) {
  // No delete: the (channel, msg_id) upsert refreshes text/images
  // while preserving status, product links and supplier links.
  mkdirSync(mediaOut, { recursive: true });
}

type PreparedPost = {
  msgId: number | null;
  date: string | null;
  text: string;
  image: string;
  phones: string;
};

const prepared: PreparedPost[] = [];
for (const message of messages) {
  if (message == null || typeof message !== "object") continue;
  const row = message as { type?: string; text?: unknown; photo?: string; id?: number; date?: string };
  if (row.type !== "message" || !row.photo) continue;
  const text = textOf(row.text);
  withPhoto += 1;
  if (text) withText += 1;
  if (dry) continue;

  // File work happens outside SQLite transactions so a large export does not
  // keep the production write lock while media is copied.
  const rel = `${row.id}_${basename(row.photo)}`;
  const src = join(exportDir, row.photo);
  if (existsSync(src)) copyFileSync(src, join(mediaOut, rel));
  copied.push(rel);
  prepared.push({
    msgId: row.id ?? null,
    date: row.date ?? null,
    text,
    image: rel,
    phones: extractPhones(text).join(","),
  });
}

if (!dry) {
  // Short batches allow the live bot/admin to write between import commits.
  const importBatch = db.transaction((rows: PreparedPost[]) => {
    for (const row of rows) {
      insert.run(row.msgId, row.date, channelName, row.text, row.image, row.phones, supplier?.id ?? null);
    }
  });
  const batchSize = 250;
  for (let i = 0; i < prepared.length; i += batchSize) {
    importBatch(prepared.slice(i, i + batchSize));
  }
}

console.log(`With photo: ${withPhoto} | with text: ${withText}`);
if (dry) {
  console.log("DRY RUN — no DB writes, no media copied.");
} else {
  const thumbs = await ensureThumbs(copied);
  console.log(`Imported ${withPhoto} posts for channel "${channelName}"`);
  if (supplier) {
    // Link the channel to the supplier so /c/<slug> serves this import.
    if (!supplier.channel_title) {
      db.query(`UPDATE suppliers SET channel_title = ? WHERE id = ?`).run(channelName, supplier.id);
      supplier.channel_title = channelName;
    }
    if (supplier.channel_slug) {
      const slug = supplier.channel_slug;
      const bySlug = db.query(`SELECT name FROM channels WHERE slug = ?`).get(slug) as any;
      if (!bySlug) {
        db.query(`INSERT INTO channels (name, slug) VALUES (?, ?)`).run(channelName, slug);
        console.log(`Store linked: /c/${slug}`);
      } else if (bySlug.name !== channelName) {
        console.log(`Note: slug /c/${slug} already points at "${bySlug.name}"`);
      }
    } else {
      let slug = slugify(channelName) || `c-${supplier.id}`;
      const taken = db.query(`SELECT name FROM channels WHERE slug = ?`).get(slug) as any;
      if (taken && taken.name !== channelName) slug = `${slug}-${supplier.id}`;
      db.query(`UPDATE suppliers SET channel_slug = ? WHERE id = ?`).run(slug, supplier.id);
      console.log(`Store slug set: /c/${slug}`);
    }
  }
  console.log(`thumbs ok=${thumbs.ok} fail=${thumbs.fail}`);
  const channels = db.query(`SELECT DISTINCT channel FROM posts ORDER BY channel`).all() as { channel: string }[];
  console.log(`All channels now in DB: ${channels.map((row) => row.channel).join(", ")}`);
}
