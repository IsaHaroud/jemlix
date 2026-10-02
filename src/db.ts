import { Database } from "bun:sqlite";
import { slugify } from "./slug.ts";

const db = new Database("./data/jemla.db", { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA busy_timeout = 5000;");

db.exec(`
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  msg_id INTEGER,
  date TEXT,
  channel TEXT,
  text TEXT,
  image TEXT,
  phone TEXT,
  status TEXT DEFAULT 'new',
  product_id INTEGER
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  category TEXT,
  price TEXT,
  stock TEXT,
  moq TEXT,
  description TEXT,
  images TEXT DEFAULT '[]',
  contact TEXT DEFAULT '',
  contact_type TEXT DEFAULT 'whatsapp',
  channel TEXT DEFAULT '',
  source_channel TEXT DEFAULT '',
  specs TEXT DEFAULT '[]',
  published INTEGER DEFAULT 0,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status, channel, msg_id);
CREATE INDEX IF NOT EXISTS idx_products_published ON products(published, id);

CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  slug TEXT UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_channels_slug ON channels(slug);

-- WORKFLOW.md Phase 1: suppliers + submissions (bot is the supplier's single place to post)
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER UNIQUE,
  name TEXT DEFAULT '',
  username TEXT DEFAULT '',
  whatsapp TEXT DEFAULT '',
  channel_id TEXT DEFAULT '',
  channel_title TEXT DEFAULT '',
  channel_slug TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_suppliers_status ON suppliers(status);
CREATE INDEX IF NOT EXISTS idx_suppliers_slug ON suppliers(channel_slug);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER,
  tg_message_id INTEGER,
  text TEXT DEFAULT '',
  image TEXT,
  status TEXT DEFAULT 'new',
  product_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status, supplier_id, id);

-- Passwordless supplier portal. Codes are short-lived and single-use; only
-- keyed hashes are stored. Browser sessions can be revoked from the bot.
CREATE TABLE IF NOT EXISTS supplier_login_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_supplier_codes_owner ON supplier_login_codes(supplier_id, expires_at);

CREATE TABLE IF NOT EXISTS supplier_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_supplier_sessions_owner ON supplier_sessions(supplier_id, expires_at);

CREATE TABLE IF NOT EXISTS supplier_product_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL,
  changes TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_supplier_edits_product ON supplier_product_edits(product_id, id);

-- Lightweight supplier CRM. Money is recorded in minor units (centimes).
-- Payments happen outside Jemlix; this is only the agreement and audit ledger.
CREATE TABLE IF NOT EXISTS supplier_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL UNIQUE REFERENCES suppliers(id) ON DELETE CASCADE,
  plan_name TEXT NOT NULL DEFAULT '',
  amount_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'MAD',
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  period_start TEXT,
  period_end TEXT,
  next_due_at TEXT,
  grace_days INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'active',
  trial_ends_at TEXT,
  next_follow_up_at TEXT,
  internal_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_supplier_subscriptions_due ON supplier_subscriptions(next_due_at, status);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  subscription_id INTEGER REFERENCES supplier_subscriptions(id) ON DELETE SET NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'MAD',
  paid_at TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'other',
  external_reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  period_start TEXT,
  period_end TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_owner ON supplier_payments(supplier_id, paid_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS supplier_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system',
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_supplier_events_owner ON supplier_events(supplier_id, id DESC);
`);

try {
  db.exec("ALTER TABLE products ADD COLUMN source_channel TEXT DEFAULT ''");
} catch {
  // Column already exists on databases created after it was added.
}

try {
  db.exec("ALTER TABLE products ADD COLUMN specs TEXT DEFAULT '[]'");
} catch {
  // Column already exists on databases created after it was added.
}

try {
  db.exec("ALTER TABLE posts ADD COLUMN supplier_id INTEGER");
} catch {
  // Column already exists.
}

try {
  db.exec("ALTER TABLE products ADD COLUMN supplier_id INTEGER");
} catch {
  // Column already exists.
}

try {
  db.exec("ALTER TABLE products ADD COLUMN price_on_request INTEGER DEFAULT 0");
} catch {
  // Column already exists.
}

try {
  db.exec("ALTER TABLE suppliers ADD COLUMN onboarding_step TEXT DEFAULT ''");
} catch {
  // Column already exists.
}

try {
  db.exec("ALTER TABLE submissions ADD COLUMN media_group_id TEXT");
} catch {
  // Column already exists.
}

try {
  db.exec("ALTER TABLE submissions ADD COLUMN images TEXT DEFAULT '[]'");
} catch {
  // Column already exists.
}

try {
  db.exec("ALTER TABLE submissions ADD COLUMN delivery TEXT DEFAULT 'pending'");
} catch {
  // Column already exists.
}

// Idempotency: one row per Telegram message (import upserts + bot intake).
// On conflict keep the row that carries curation work, else the newest.
try {
  db.exec(`DELETE FROM posts WHERE id NOT IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY channel, msg_id
        ORDER BY (product_id IS NOT NULL) DESC, (status != 'new') DESC, id DESC
      ) AS rn FROM posts
    ) WHERE rn = 1
  )`);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_channel_msg ON posts(channel, msg_id)");
} catch {
  // Old DBs with unresolvable duplicates keep the old behavior; import still works.
}

try {
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_supplier_msg ON submissions(supplier_id, tg_message_id)",
  );
} catch {
  // ignore
}

// One confirmed Telegram channel can belong to only one supplier. Empty values
// are excluded because every unlinked supplier stores an empty string.
try {
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_channel_id ON suppliers(channel_id) WHERE channel_id != ''");
} catch {
  // A legacy duplicate must be reviewed manually before this index can apply.
}

linkDonePosts();
backfillChannels();
backfillPostSuppliers();

function backfillPostSuppliers(): void {
  // Link old imports (supplier_id NULL) to suppliers via the channel title.
  try {
    db.query(
      `UPDATE posts SET supplier_id = (SELECT id FROM suppliers WHERE channel_title = posts.channel)
       WHERE supplier_id IS NULL AND channel != ''`,
    ).run();
  } catch {
    // suppliers table may predate this migration; ignore
  }
}

function linkDonePosts(): void {
  const posts = db
    .query(
      `SELECT id, image FROM posts
       WHERE status = 'done' AND product_id IS NULL AND image IS NOT NULL AND image != ''`,
    )
    .all() as { id: number; image: string }[];
  if (!posts.length) return;

  const products = db.query(`SELECT id, images FROM products`).all() as { id: number; images: string }[];
  const link = db.query(`UPDATE posts SET product_id = ? WHERE id = ? AND product_id IS NULL`);
  for (const post of posts) {
    const hits = products.filter((product) => {
      try {
        const images = JSON.parse(product.images || "[]");
        return Array.isArray(images) && images.includes(post.image);
      } catch {
        return false;
      }
    });
    if (hits.length === 1) link.run(hits[0]!.id, post.id);
  }
}

function backfillChannels(): void {
  const names = db
    .query(`SELECT DISTINCT channel AS name FROM posts WHERE channel != '' ORDER BY channel`)
    .all() as { name: string }[];
  const exists = db.query(`SELECT 1 FROM channels WHERE name = ?`);
  const insert = db.query(`INSERT INTO channels (name, slug) VALUES (?, '')`);
  const setSlug = db.query(`UPDATE channels SET slug = ? WHERE id = ?`);
  const slugTaken = db.query(`SELECT 1 FROM channels WHERE slug = ? AND id != ?`);

  for (const { name } of names) {
    if (exists.get(name)) continue;
    const info = insert.run(name);
    const id = Number(info.lastInsertRowid);
    let slug = slugify(name) || `c-${id}`;
    if (slugTaken.get(slug, id)) slug = `${slug}-${id}`;
    setSlug.run(slug, id);
  }
}

export default db;
