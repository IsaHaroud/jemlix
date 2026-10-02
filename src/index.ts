import { config } from "./config.ts";
import db from "./db.ts";
import { parseProduct } from "./product.ts";
import { parseSubmissionCreate, parseSupplierCreate, parseSupplierPatch, parseSupplierProductPatch } from "./suppliers.ts";
import { safeChild } from "./paths.ts";
import { isValidSlug } from "./slug.ts";
import {
  exchangeSupplierCode,
  isSupplierCode,
  revokeAllSupplierSessions,
  revokeSupplierSession,
  supplierFromSessionToken,
  SUPPLIER_SESSION_TTL_MS,
} from "./supplier-auth.ts";
import { addSupplierEvent, billingPhase, parsePayment, parseSubscription } from "./supplier-crm.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
};

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

async function file(path: string, cache = ""): Promise<Response | null> {
  const f = Bun.file(path);
  if (!(await f.exists())) return null;
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  const headers: Record<string, string> = { "Content-Type": MIME[ext] ?? "application/octet-stream" };
  if (cache) headers["Cache-Control"] = cache;
  return new Response(f, { headers });
}

// ---- auth ----
const COOKIE = "jemla_token";
const SUPPLIER_COOKIE = "jemla_supplier_session";

function tokenFromReq(req: Request): string | null {
  const h =
    req.headers.get("x-admin-token") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (h) return h.trim();
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (m) {
    try {
      return decodeURIComponent(m[1]!);
    } catch {
      return m[1]!;
    }
  }
  return null;
}

function cookieValue(req: Request, name: string): string | null {
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
}

function supplierCookie(req: Request, token: string, maxAgeSeconds: number): string {
  const secure = requestIsSecure(req);
  return `${SUPPLIER_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
}

function requestIsSecure(req: Request): boolean {
  return new URL(req.url).protocol === "https:"
    || req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https"
    || config.publicBaseUrl.startsWith("https://");
}

function adminCookie(req: Request, value: string, maxAgeSeconds: number): string {
  return `${COOKIE}=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${requestIsSecure(req) ? "; Secure" : ""}`;
}

function isAuthed(req: Request): boolean {
  if (!config.adminToken) return true; // dev: open
  return tokenFromReq(req) === config.adminToken;
}

// ---- login rate limiting (per IP) ----
const attempts = new Map<string, { count: number; until: number }>();
const supplierAttempts = new Map<string, { count: number; until: number }>();

function tooManyAttempts(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry) return false;
  if (entry.until < now) {
    attempts.delete(ip);
    return false;
  }
  return entry.count >= 5;
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.until < now) attempts.set(ip, { count: 1, until: now + 60_000 });
  else entry.count += 1;
}

function supplierLoginBlocked(ip: string): boolean {
  const now = Date.now();
  const entry = supplierAttempts.get(ip);
  if (!entry || entry.until < now) {
    if (entry) supplierAttempts.delete(ip);
    return false;
  }
  return entry.count >= 5;
}

function recordSupplierFailure(ip: string): void {
  const now = Date.now();
  const entry = supplierAttempts.get(ip);
  if (!entry || entry.until < now) supplierAttempts.set(ip, { count: 1, until: now + 10 * 60_000 });
  else entry.count += 1;
  if (supplierAttempts.size > 2000) {
    for (const [key, value] of supplierAttempts) if (value.until < now) supplierAttempts.delete(key);
  }
}

// ---- queries ----
const listPublished = db.query(`SELECT * FROM products WHERE published = 1 ORDER BY id DESC`);
const listAllProducts = db.query(`SELECT * FROM products ORDER BY id DESC`);
const insertProduct = db.query(`
  INSERT INTO products (name, category, price, price_on_request, stock, moq, description, images, contact, contact_type, channel, source_channel, specs, supplier_id, published, created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
`);
const linkPost = db.query(`UPDATE posts SET product_id = ?, status = 'done' WHERE id = ?`);
const unlinkPosts = db.query(`UPDATE posts SET status = 'new', product_id = NULL WHERE product_id = ?`);
const deleteProduct = db.query(`DELETE FROM products WHERE id = ?`);
const setPostStatus = db.query(`UPDATE posts SET status = ? WHERE id = ?`);

// ---- WORKFLOW.md Phase 1: suppliers + submissions ----
const getSupplier = db.query(`SELECT * FROM suppliers WHERE id = ?`);
const insertSupplier = db.query(`INSERT INTO suppliers (telegram_id, name, username, whatsapp, channel_id, channel_title, channel_slug, status) VALUES (?,?,?,?,?,?,?,?)`);
const linkSubmission = db.query(`UPDATE submissions SET product_id = ?, status = 'published' WHERE id = ?`);
const unlinkSubmissions = db.query(`UPDATE submissions SET status = 'new', product_id = NULL WHERE product_id = ?`);
const setSubmissionStatus = db.query(`UPDATE submissions SET status = ? WHERE id = ?`);

function ensureStoreChannel(slug: string, name: string): void {
  if (!slug) return;
  const bySlug = db.query(`SELECT slug FROM channels WHERE slug = ?`).get(slug);
  if (bySlug) return;
  const label = (name || "").trim() || slug;
  const byName = db.query(`SELECT slug FROM channels WHERE name = ?`).get(label);
  if (byName) {
    db.query(`UPDATE channels SET slug = ? WHERE name = ?`).run(slug, label);
    return;
  }
  db.query(`INSERT INTO channels (name, slug) VALUES (?, ?)`).run(label, slug);
}

// A supplier's store is public only when the supplier is active.
// Channels with no supplier link (legacy imports) stay public.
function hiddenStores(): { slugs: Set<string>; names: Set<string> } {
  const slugs = new Set<string>();
  const names = new Set<string>();
  try {
    const rows = db.query(`SELECT channel_slug, channel_title FROM suppliers WHERE status != 'active'`).all() as any[];
    for (const r of rows) {
      if (r.channel_slug) slugs.add(r.channel_slug);
      if (r.channel_title) names.add(r.channel_title);
    }
    if (slugs.size) {
      const marks = [...slugs].map(() => "?").join(",");
      const chans = db.query(`SELECT name, slug FROM channels WHERE slug IN (${marks})`).all(...[...slugs]) as any[];
      for (const c of chans) {
        if (c.name) names.add(c.name);
      }
    }
  } catch {
    // tables may not exist on very old DBs until migrated
  }
  return { slugs, names };
}

function notifyAdmin(text: string): void {
  if (!config.botToken || !config.adminChatId) return;
  import("./bot.ts").then((m) => m.notifyAdmin(text).catch(() => {})).catch(() => {});
}

function notifySupplier(telegramId: number, text: string): void {
  if (!config.botToken || !telegramId) return;
  import("./bot.ts").then((m) => m.notifySupplier(telegramId, text).catch(() => {})).catch(() => {});
}

function parseRow(r: any) {
  return { ...r, images: JSON.parse(r.images || "[]"), specs: JSON.parse(r.specs || "[]") };
}

function imageOk(name: string): boolean {
  return safeChild("media", name) !== null;
}

function intParam(v: string | null, fallback: number, max: number): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) return fallback;
  return Math.min(n, max);
}

// ---- posts listing (paginated + filtered) ----
function listPosts(params: URLSearchParams) {
  const status = params.get("status") || "";
  const channel = params.get("channel") || "";
  const supplierIdRaw = params.get("supplier_id") || "";
  const q = params.get("q") || "";
  const offset = intParam(params.get("offset"), 0, 1_000_000);
  const limit = intParam(params.get("limit"), 40, 200);

  const where: string[] = [];
  const args: unknown[] = [];
  if (status) {
    where.push("status = ?");
    args.push(status);
  }
  if (channel) {
    where.push("channel = ?");
    args.push(channel);
  }
  if (supplierIdRaw === "unlinked") {
    where.push("supplier_id IS NULL");
  } else if (supplierIdRaw) {
    const sid = Number(supplierIdRaw);
    if (!Number.isInteger(sid) || sid <= 0) return { items: [], total: 0, counts: { new: 0, done: 0, skipped: 0 } };
    where.push("supplier_id = ?");
    args.push(sid);
  }
  if (q) {
    where.push("text LIKE ?");
    args.push(`%${q}%`);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = (db.query(`SELECT COUNT(*) AS c FROM posts ${clause}`).get(...args) as any).c;
  const items = db
    .query(`SELECT * FROM posts ${clause} ORDER BY msg_id ASC LIMIT ? OFFSET ?`)
    .all(...args, limit, offset);

  const countsRows = db.query(`SELECT status, COUNT(*) AS c FROM posts GROUP BY status`).all() as any[];
  const counts: Record<string, number> = { new: 0, done: 0, skipped: 0 };
  for (const row of countsRows) counts[row.status] = row.c;

  return { items: items.map((r: any) => ({ ...r, phone: r.phone ? r.phone.split(",").filter(Boolean) : [] })), total, counts };
}

// ---- images listing (paginated + searchable) ----
function listImages(params: URLSearchParams) {
  const q = params.get("q") || "";
  const offset = intParam(params.get("offset"), 0, 1_000_000);
  const limit = intParam(params.get("limit"), 40, 200);

  let total: number;
  let items: any[];
  if (q) {
    total = (db.query(`SELECT COUNT(*) AS c FROM posts WHERE image LIKE ?`).get(`%${q}%`) as any).c;
    items = db.query(`SELECT image FROM posts WHERE image LIKE ? ORDER BY msg_id ASC LIMIT ? OFFSET ?`).all(`%${q}%`, limit, offset);
  } else {
    total = (db.query(`SELECT COUNT(*) AS c FROM posts WHERE image IS NOT NULL`).get() as any).c;
    items = db.query(`SELECT image FROM posts WHERE image IS NOT NULL ORDER BY msg_id ASC LIMIT ? OFFSET ?`).all(limit, offset);
  }
  return { items: items.map((r: any) => r.image), total };
}

async function readBody(req: Request): Promise<any | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

function supplierProductList(supplierId: number, params: URLSearchParams) {
  const q = (params.get("q") || "").trim().slice(0, 100);
  const status = params.get("status") || "all";
  const offset = intParam(params.get("offset"), 0, 1_000_000);
  const limit = intParam(params.get("limit"), 25, 50);
  const where = ["supplier_id = ?"];
  const args: unknown[] = [supplierId];
  if (status === "active") where.push("published = 1");
  else if (status === "hidden") where.push("published = 0");
  if (q) {
    where.push("(name LIKE ? OR description LIKE ?)");
    args.push(`%${q}%`, `%${q}%`);
  }
  const clause = `WHERE ${where.join(" AND ")}`;
  const total = (db.query(`SELECT COUNT(*) AS c FROM products ${clause}`).get(...args) as any).c;
  const items = db.query(
    `SELECT * FROM products ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`,
  ).all(...args, limit, offset).map(parseRow);
  const counts = db.query(
    `SELECT COUNT(*) AS all_count,
            COALESCE(SUM(CASE WHEN published = 1 THEN 1 ELSE 0 END), 0) AS active,
            COALESCE(SUM(CASE WHEN published = 0 THEN 1 ELSE 0 END), 0) AS hidden
     FROM products WHERE supplier_id = ?`,
  ).get(supplierId);
  return { items, total, counts, offset, limit };
}

function suppliersWithBilling(): any[] {
  const rows = db.query(
    `SELECT s.*,
            ss.id AS subscription_id, ss.plan_name, ss.amount_minor, ss.currency,
            ss.billing_cycle, ss.period_start, ss.period_end, ss.next_due_at,
            ss.grace_days, ss.status AS billing_status, ss.trial_ends_at,
            ss.next_follow_up_at, ss.internal_note,
            (SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.id) AS product_count,
            (SELECT COUNT(*) FROM submissions sub WHERE sub.supplier_id = s.id AND sub.status = 'new') AS new_submissions,
            (SELECT MAX(sp.paid_at) FROM supplier_payments sp WHERE sp.supplier_id = s.id) AS last_payment_at
     FROM suppliers s
     LEFT JOIN supplier_subscriptions ss ON ss.supplier_id = s.id
     ORDER BY s.id DESC`,
  ).all() as any[];
  return rows.map((row) => ({
    ...row,
    ...billingPhase(row.subscription_id ? { ...row, status: row.billing_status } : null),
  }));
}

function supplierDetail(id: number): any | null {
  const supplier = getSupplier.get(id) as any;
  if (!supplier) return null;
  const subscription = db.query(`SELECT * FROM supplier_subscriptions WHERE supplier_id = ?`).get(id) as any;
  const payments = db.query(
    `SELECT * FROM supplier_payments WHERE supplier_id = ? ORDER BY paid_at DESC, id DESC LIMIT 100`,
  ).all(id) as any[];
  const events = db.query(
    `SELECT id, event_type, actor, details, created_at FROM supplier_events
     WHERE supplier_id = ? ORDER BY id DESC LIMIT 100`,
  ).all(id).map((row: any) => {
    try {
      return { ...row, details: JSON.parse(row.details || "{}") };
    } catch {
      return { ...row, details: {} };
    }
  });
  const edits = db.query(
    `SELECT e.id, e.product_id, e.changes, e.created_at, p.name AS product_name
     FROM supplier_product_edits e LEFT JOIN products p ON p.id = e.product_id
     WHERE e.supplier_id = ? ORDER BY e.id DESC LIMIT 100`,
  ).all(id).map((row: any) => {
    let changes = {};
    try { changes = JSON.parse(row.changes || "{}"); } catch { /* keep empty */ }
    return {
      id: `edit-${row.id}`,
      event_type: "product_edit",
      actor: "supplier",
      details: { product_id: row.product_id, product_name: row.product_name, changes },
      created_at: row.created_at,
    };
  });
  const timeline = [...events, ...edits]
    .sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 100);
  const currentPaid = subscription
    ? payments
      .filter((payment) => (!subscription.period_start || payment.period_start === subscription.period_start)
        && (!subscription.period_end || payment.period_end === subscription.period_end))
      .reduce((sum, payment) => sum + Number(payment.amount_minor || 0), 0)
    : 0;
  const counts = db.query(
    `SELECT COUNT(*) AS products,
            COALESCE(SUM(CASE WHEN published = 1 THEN 1 ELSE 0 END), 0) AS published_products
     FROM products WHERE supplier_id = ?`,
  ).get(id) as any;
  return {
    supplier,
    subscription: subscription ? { ...subscription, ...billingPhase(subscription) } : null,
    payments,
    timeline,
    summary: {
      products: Number(counts?.products || 0),
      published_products: Number(counts?.published_products || 0),
      total_paid_minor: payments.reduce((sum, payment) => sum + Number(payment.amount_minor || 0), 0),
      current_paid_minor: currentPaid,
      outstanding_minor: subscription ? Math.max(Number(subscription.amount_minor || 0) - currentPaid, 0) : 0,
    },
  };
}

// ---- routes ----
async function api(req: Request, url: URL): Promise<Response> {
  const p = url.pathname;
  const method = req.method;

  // ---- public ----
  if (p === "/api/products" && method === "GET") {
    const hidden = hiddenStores();
    const channel = url.searchParams.get("channel") || "";
    if (channel) {
      if (hidden.names.has(channel)) return json([]);
      const rows = db
        .query(`SELECT * FROM products WHERE published = 1 AND source_channel = ? ORDER BY id DESC`)
        .all(channel);
      return json(rows.map(parseRow).filter((r: any) => !hidden.names.has(r.source_channel)));
    }
    const rows = listPublished.all().map(parseRow);
    return json(rows.filter((r: any) => !hidden.names.has(r.source_channel)));
  }
  const prodDetail = p.match(/^\/api\/products\/(\d+)$/);
  if (prodDetail && method === "GET") {
    const row = db.query(`SELECT * FROM products WHERE published = 1 AND id = ?`).get(Number(prodDetail[1]));
    if (!row) return json({ error: "not found" }, 404);
    const parsed = parseRow(row);
    if (hiddenStores().names.has(parsed.source_channel)) return json({ error: "not found" }, 404);
    return json(parsed);
  }
  if (p === "/api/categories" && method === "GET") {
    return json(config.categories);
  }
  if (p === "/api/channels" && method === "GET") {
    const hidden = hiddenStores();
    const rows = db
      .query(
        `SELECT c.name, c.slug, COUNT(p.id) AS count
         FROM channels c
         LEFT JOIN products p ON p.source_channel = c.name AND p.published = 1
         GROUP BY c.id ORDER BY c.name`,
      )
      .all() as any[];
    return json(rows.filter((r) => !hidden.slugs.has(r.slug) && !hidden.names.has(r.name)));
  }
  const chanDetail = p.match(/^\/api\/channels\/([^/]+)$/);
  if (chanDetail && method === "GET") {
    if (hiddenStores().slugs.has(chanDetail[1]!)) return json({ error: "not found" }, 404);
    const row = db.query(`SELECT name, slug FROM channels WHERE slug = ?`).get(chanDetail[1]);
    if (!row) return json({ error: "not found" }, 404);
    return json(row);
  }

  if (p === "/api/login" && method === "POST") {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (tooManyAttempts(ip)) return json({ error: "too many attempts" }, 429);
    if (!config.adminToken) return json({ ok: true }); // dev: no password set
    const body = await readBody(req);
    if (body?.token === config.adminToken) {
      attempts.delete(ip);
      return json({ ok: true }, 200, {
        "Set-Cookie": adminCookie(req, config.adminToken, 86400),
      });
    }
    recordFailure(ip);
    return json({ error: "invalid token" }, 401);
  }

  if (p === "/api/logout" && method === "POST") {
    return json({ ok: true }, 200, {
      "Set-Cookie": adminCookie(req, "", 0),
    });
  }

  // ---- passwordless supplier portal ----
  if (p === "/api/supplier/login" && method === "POST") {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (supplierLoginBlocked(ip)) return json({ error: "محاولات كثيرة. عاود من بعد." }, 429);
    const body = await readBody(req);
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    if (!isSupplierCode(code)) {
      recordSupplierFailure(ip);
      return json({ error: "الكود خاصو يكون 6 أرقام" }, 400);
    }
    let result = null;
    try {
      result = exchangeSupplierCode(code);
    } catch (err) {
      console.error("supplier login error:", err instanceof Error ? err.message : err);
      return json({ error: "الدخول ما خدمش دابا" }, 500);
    }
    if (!result) {
      recordSupplierFailure(ip);
      return json({ error: "الكود غير صالح أو سالا الوقت ديالو" }, 401);
    }
    supplierAttempts.delete(ip);
    return json({ ok: true }, 200, {
      "Set-Cookie": supplierCookie(req, result.token, Math.floor(SUPPLIER_SESSION_TTL_MS / 1000)),
    });
  }

  if (p === "/api/supplier/logout" && method === "POST") {
    revokeSupplierSession(cookieValue(req, SUPPLIER_COOKIE));
    return json({ ok: true }, 200, { "Set-Cookie": supplierCookie(req, "", 0) });
  }

  if (p.startsWith("/api/supplier/")) {
    const supplier = supplierFromSessionToken(cookieValue(req, SUPPLIER_COOKIE));
    if (!supplier) return json({ error: "supplier unauthorized" }, 401);

    if (p === "/api/supplier/me" && method === "GET") {
      return json({
        id: supplier.id,
        name: supplier.name,
        channel_title: supplier.channel_title,
        channel_slug: supplier.channel_slug,
      });
    }
    if (p === "/api/supplier/products" && method === "GET") {
      return json(supplierProductList(supplier.id, url.searchParams));
    }
    const supplierProduct = p.match(/^\/api\/supplier\/products\/(\d+)$/);
    if (supplierProduct && method === "PATCH") {
      const id = Number(supplierProduct[1]);
      const current = db.query(
        `SELECT * FROM products WHERE id = ? AND supplier_id = ?`,
      ).get(id, supplier.id) as any;
      if (!current) return json({ error: "المنتج ما كاينش" }, 404);
      const parsed = parseSupplierProductPatch(await readBody(req));
      if (!parsed.ok) return json({ error: parsed.error }, 400);
      const change = parsed.value;
      const next = {
        price: change.price ?? current.price ?? "",
        price_on_request: change.price_on_request ?? !!current.price_on_request,
        stock: change.stock ?? current.stock ?? "",
        moq: change.moq ?? current.moq ?? "",
        description: change.description ?? current.description ?? "",
        published: change.published ?? !!current.published,
      };
      if (next.published && !next.price && !next.price_on_request) {
        return json({ error: "دخل الثمن أو اختار الثمن عند الطلب" }, 400);
      }
      if (change.published === true && !next.moq) {
        return json({ error: "دخل الحد الأدنى قبل ما تبين المنتج" }, 400);
      }
      const save = db.transaction(() => {
        const info = db.query(
          `UPDATE products
           SET price = ?, price_on_request = ?, stock = ?, moq = ?, description = ?, published = ?
           WHERE id = ? AND supplier_id = ?`,
        ).run(
          next.price, next.price_on_request ? 1 : 0, next.stock, next.moq,
          next.description, next.published ? 1 : 0, id, supplier.id,
        );
        if (info.changes !== 1) throw new Error("supplier product ownership changed");
        db.query(
          `INSERT INTO supplier_product_edits (supplier_id, product_id, changes) VALUES (?,?,?)`,
        ).run(supplier.id, id, JSON.stringify(change));
      });
      save();
      const updated = db.query(`SELECT * FROM products WHERE id = ? AND supplier_id = ?`).get(id, supplier.id);
      return json({ ok: true, product: parseRow(updated) });
    }
    return json({ error: "Not found" }, 404);
  }

  // ---- admin (auth required) ----
  if (!isAuthed(req)) return json({ error: "unauthorized" }, 401);

  if (p === "/api/posts" && method === "GET") return json(listPosts(url.searchParams));
  if (p === "/api/images" && method === "GET") return json(listImages(url.searchParams));
  if (p === "/api/channels" && method === "PATCH") {
    const body = await readBody(req);
    if (!body || typeof body.name !== "string" || typeof body.slug !== "string" || !isValidSlug(body.slug)) {
      return json({ error: "bad request" }, 400);
    }
    const taken = db.query(`SELECT name FROM channels WHERE slug = ? AND name != ?`).get(body.slug, body.name);
    if (taken) return json({ error: "slug taken" }, 409);
    const info = db.query(`UPDATE channels SET slug = ? WHERE name = ?`).run(body.slug, body.name);
    if (info.changes === 0) return json({ error: "not found" }, 404);
    return json({ ok: true });
  }
  if (p === "/api/config" && method === "GET") {
    return json({ defaultWhatsapp: config.defaultWhatsapp, defaultChannel: config.defaultChannel });
  }
  if (p === "/api/admin/products" && method === "GET") {
    const supplierIdRaw = url.searchParams.get("supplier_id") || "";
    const q = (url.searchParams.get("q") || "").trim();
    let rows = listAllProducts.all().map(parseRow);
    if (supplierIdRaw === "unlinked") rows = rows.filter((r: any) => r.supplier_id == null);
    else if (supplierIdRaw) {
      const sid = Number(supplierIdRaw);
      if (!Number.isInteger(sid) || sid <= 0) return json([]);
      rows = rows.filter((r: any) => r.supplier_id === sid);
    }
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter((r: any) => `${r.name || ""} ${r.description || ""}`.toLowerCase().includes(needle));
    }
    return json(rows);
  }

  // ---- suppliers (admin) ----
  if (p === "/api/suppliers" && method === "GET") {
    return json(suppliersWithBilling());
  }
  if (p === "/api/suppliers" && method === "POST") {
    const input = await readBody(req);
    const result = parseSupplierCreate(input);
    if (!result.ok) return json({ error: result.error }, 400);
    const v = result.value;
    if (v.telegram_id != null) {
      const taken = db.query(`SELECT id FROM suppliers WHERE telegram_id = ?`).get(v.telegram_id);
      if (taken) return json({ error: "هذا المورّد مسجل already" }, 409);
    }
    if (v.channel_slug) {
      const taken = db.query(`SELECT id FROM suppliers WHERE channel_slug = ?`).get(v.channel_slug);
      if (taken) return json({ error: "السيلغ مستعمل" }, 409);
    }
    const info = insertSupplier.run(v.telegram_id, v.name, v.username, v.whatsapp, "", "", v.channel_slug, v.status);
    const id = Number(info.lastInsertRowid);
    addSupplierEvent(id, "supplier_created", { status: v.status, name: v.name });
    if (v.channel_slug) ensureStoreChannel(v.channel_slug, v.name);
    if (v.status === "pending") notifyAdmin(`مورّد جديد بانتظار المراجعة: ${v.name || `#${id}`}`);
    return json({ ok: true, id });
  }

  const supplierDetailMatch = p.match(/^\/api\/suppliers\/(\d+)\/detail$/);
  if (supplierDetailMatch && method === "GET") {
    const detail = supplierDetail(Number(supplierDetailMatch[1]));
    return detail ? json(detail) : json({ error: "not found" }, 404);
  }

  const supplierSubscriptionMatch = p.match(/^\/api\/suppliers\/(\d+)\/subscription$/);
  if (supplierSubscriptionMatch && method === "PUT") {
    const id = Number(supplierSubscriptionMatch[1]);
    if (!getSupplier.get(id)) return json({ error: "not found" }, 404);
    const parsed = parseSubscription(await readBody(req));
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const v = parsed.value;
    const previous = db.query(`SELECT * FROM supplier_subscriptions WHERE supplier_id = ?`).get(id);
    const save = db.transaction(() => {
      db.query(
        `INSERT INTO supplier_subscriptions
          (supplier_id, plan_name, amount_minor, currency, billing_cycle, period_start, period_end,
           next_due_at, grace_days, status, trial_ends_at, next_follow_up_at, internal_note)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(supplier_id) DO UPDATE SET
           plan_name = excluded.plan_name, amount_minor = excluded.amount_minor,
           currency = excluded.currency, billing_cycle = excluded.billing_cycle,
           period_start = excluded.period_start, period_end = excluded.period_end,
           next_due_at = excluded.next_due_at, grace_days = excluded.grace_days,
           status = excluded.status, trial_ends_at = excluded.trial_ends_at,
           next_follow_up_at = excluded.next_follow_up_at,
           internal_note = excluded.internal_note, updated_at = datetime('now')`,
      ).run(
        id, v.plan_name, v.amount_minor, v.currency, v.billing_cycle, v.period_start,
        v.period_end, v.next_due_at, v.grace_days, v.status, v.trial_ends_at,
        v.next_follow_up_at, v.internal_note,
      );
      addSupplierEvent(id, previous ? "subscription_updated" : "subscription_created", {
        plan_name: v.plan_name,
        amount_minor: v.amount_minor,
        currency: v.currency,
        billing_cycle: v.billing_cycle,
        status: v.status,
        next_due_at: v.next_due_at,
        next_follow_up_at: v.next_follow_up_at,
      });
    });
    save();
    return json({ ok: true, detail: supplierDetail(id) });
  }

  const supplierPaymentsMatch = p.match(/^\/api\/suppliers\/(\d+)\/payments$/);
  if (supplierPaymentsMatch && method === "POST") {
    const id = Number(supplierPaymentsMatch[1]);
    if (!getSupplier.get(id)) return json({ error: "not found" }, 404);
    const subscription = db.query(`SELECT * FROM supplier_subscriptions WHERE supplier_id = ?`).get(id) as any;
    if (!subscription) return json({ error: "سجّل الاشتراك قبل الأداء" }, 409);
    const parsed = parsePayment(await readBody(req));
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const v = parsed.value;
    const save = db.transaction(() => {
      const info = db.query(
        `INSERT INTO supplier_payments
          (supplier_id, subscription_id, amount_minor, currency, paid_at, method,
           external_reference, note, period_start, period_end)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id, subscription.id, v.amount_minor, v.currency, v.paid_at, v.method,
        v.external_reference, v.note, v.period_start, v.period_end,
      );
      db.query(
        `UPDATE supplier_subscriptions SET
           period_start = COALESCE(?, period_start), period_end = COALESCE(?, period_end),
           next_due_at = COALESCE(?, next_due_at),
           status = CASE WHEN status = 'trial' THEN 'active' ELSE status END,
           updated_at = datetime('now')
         WHERE supplier_id = ?`,
      ).run(v.period_start, v.period_end, v.next_due_at, id);
      addSupplierEvent(id, "payment_recorded", {
        payment_id: Number(info.lastInsertRowid), amount_minor: v.amount_minor,
        currency: v.currency, paid_at: v.paid_at, method: v.method,
        external_reference: v.external_reference, period_start: v.period_start,
        period_end: v.period_end, next_due_at: v.next_due_at,
      });
    });
    save();
    return json({ ok: true, detail: supplierDetail(id) });
  }

  const supplierNotesMatch = p.match(/^\/api\/suppliers\/(\d+)\/notes$/);
  if (supplierNotesMatch && method === "POST") {
    const id = Number(supplierNotesMatch[1]);
    if (!getSupplier.get(id)) return json({ error: "not found" }, 404);
    const body = await readBody(req);
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text || text.length > 2000) return json({ error: "الملاحظة غير صالحة" }, 400);
    addSupplierEvent(id, "admin_note", { text });
    return json({ ok: true, detail: supplierDetail(id) });
  }

  const supplierRevokeMatch = p.match(/^\/api\/suppliers\/(\d+)\/revoke-sessions$/);
  if (supplierRevokeMatch && method === "POST") {
    const id = Number(supplierRevokeMatch[1]);
    if (!getSupplier.get(id)) return json({ error: "not found" }, 404);
    const revoked = revokeAllSupplierSessions(id, "admin");
    return json({ ok: true, revoked });
  }

  const suppMatch = p.match(/^\/api\/suppliers\/(\d+)$/);
  if (suppMatch && method === "PATCH") {
    const id = Number(suppMatch[1]);
    const current = getSupplier.get(id) as any;
    if (!current) return json({ error: "not found" }, 404);
    const input = await readBody(req);
    const result = parseSupplierPatch(input);
    if (!result.ok) return json({ error: result.error }, 400);
    const v = result.value;
    if (v.telegram_id !== undefined && v.telegram_id != null) {
      const taken = db.query(`SELECT id FROM suppliers WHERE telegram_id = ? AND id != ?`).get(v.telegram_id, id);
      if (taken) return json({ error: "هذا المعرف مسجل" }, 409);
    }
    if (v.channel_slug !== undefined && v.channel_slug) {
      const taken = db.query(`SELECT id FROM suppliers WHERE channel_slug = ? AND id != ?`).get(v.channel_slug, id);
      if (taken) return json({ error: "السيلغ مستعمل" }, 409);
      const chanTaken = db.query(`SELECT name FROM channels WHERE slug = ?`).get(v.channel_slug) as any;
      if (chanTaken && chanTaken.name !== current.channel_title && chanTaken.name !== current.name && chanTaken.name !== v.channel_title) {
        // slug belongs to a different channel name; admin owns slugs so allow but keep mapping via ensure
      }
    }
    if (v.channel_id !== undefined || v.channel_title !== undefined) {
      const channelId = v.channel_id !== undefined ? v.channel_id : current.channel_id;
      const title = v.channel_title !== undefined ? v.channel_title : current.channel_title;
      if (!channelId || !title) return json({ error: "دخل معرف القناة واسمها" }, 400);
      const taken = db.query(`SELECT id, name FROM suppliers WHERE channel_id = ? AND id != ?`).get(channelId, id) as any;
      if (taken) return json({ error: `القناة مربوطة من قبل مع ${taken.name || `المورّد #${taken.id}`}` }, 409);
    }
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [k, val] of Object.entries(v)) {
      sets.push(`${k} = ?`);
      args.push(val);
    }
    db.query(`UPDATE suppliers SET ${sets.join(", ")} WHERE id = ?`).run(...args, id);
    const updated = getSupplier.get(id) as any;
    const manualChannelLink = v.channel_id !== undefined || v.channel_title !== undefined;
    addSupplierEvent(
      id,
      manualChannelLink ? "channel_linked_manual" : "supplier_updated",
      manualChannelLink
        ? { channel_id: updated.channel_id, channel_title: updated.channel_title, channel_slug: updated.channel_slug }
        : v,
    );
    if (updated?.channel_slug) ensureStoreChannel(updated.channel_slug, updated.channel_title || updated.name);
    return json({ ok: true });
  }

  // ---- submissions (admin) ----
  if (p === "/api/submissions" && method === "GET") {
    const status = url.searchParams.get("status") || "";
    const supplierId = Number(url.searchParams.get("supplier_id") || 0);
    const offset = intParam(url.searchParams.get("offset"), 0, 1_000_000);
    const limit = intParam(url.searchParams.get("limit"), 40, 200);
    const where: string[] = [];
    const args: unknown[] = [];
    if (status) {
      where.push("s.status = ?");
      args.push(status);
    }
    if (supplierId) {
      where.push("s.supplier_id = ?");
      args.push(supplierId);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = (db.query(`SELECT COUNT(*) AS c FROM submissions s ${clause}`).get(...args) as any).c;
    const items = db
      .query(
        `SELECT s.*, u.name AS supplier_name FROM submissions s LEFT JOIN suppliers u ON u.id = s.supplier_id ${clause} ORDER BY s.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset);
    return json({ items, total });
  }
  if (p === "/api/submissions" && method === "POST") {
    const input = await readBody(req);
    const result = parseSubmissionCreate(input, { imageOk });
    if (!result.ok) return json({ error: result.error }, 400);
    const supplier = getSupplier.get(result.value.supplier_id);
    if (!supplier) return json({ error: "المورّد غير موجود" }, 404);
    const info = db
      .query(`INSERT INTO submissions (supplier_id, tg_message_id, text, image, status) VALUES (?,?,?,?, 'new')`)
      .run(result.value.supplier_id, result.value.tg_message_id, result.value.text, result.value.image || null);
    return json({ ok: true, id: Number(info.lastInsertRowid) });
  }
  if (p === "/api/submissions/status" && method === "POST") {
    const body = await readBody(req);
    if (!body || !["new", "published", "skipped"].includes(body.status) || !Array.isArray(body.ids)) {
      return json({ error: "bad request" }, 400);
    }
    const ids = body.ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0);
    for (const id of ids) setSubmissionStatus.run(body.status, id);
    return json({ ok: true });
  }

  if (p === "/api/products" && method === "POST") {
    const input = await readBody(req);
    const raw = (input ?? {}) as Record<string, unknown>;
    const published = raw.published === 0 || raw.published === false ? 0 : 1;
    const result = parseProduct(input, { categories: config.categories, imageOk }, published ? "publish" : "draft");
    if (!result.ok) return json({ error: result.error }, 400);
    const v = result.value;
    // Optional WORKFLOW.md linkage: supplier + submissions.
    let supplierId: number | null = null;
    if (raw.supplier_id != null && raw.supplier_id !== "") {
      supplierId = Number(raw.supplier_id);
      if (!Number.isInteger(supplierId) || supplierId <= 0) return json({ error: "المورّد غير صالح" }, 400);
      if (!getSupplier.get(supplierId)) return json({ error: "المورّد غير موجود" }, 404);
    }
    if (published && supplierId == null) return json({ error: "المورّد إجباري للنشر" }, 400);
    let submissionIds: number[] = [];
    if (raw.submission_ids != null) {
      if (!Array.isArray(raw.submission_ids) || raw.submission_ids.length > 20) {
        return json({ error: "المرسلات غير صالحة" }, 400);
      }
      for (const sid of raw.submission_ids) {
        if (typeof sid !== "number" || !Number.isInteger(sid) || sid <= 0) {
          return json({ error: "المرسلات غير صالحة" }, 400);
        }
        if (!submissionIds.includes(sid)) submissionIds.push(sid);
      }
    }
    const create = db.transaction(() => {
      const info = insertProduct.run(
        v.name, v.category, v.price, v.priceOnRequest ? 1 : 0, v.stock, v.moq, v.description,
        JSON.stringify(v.images), v.contact, v.contactType, "", v.sourceChannel,
        JSON.stringify(v.specs), supplierId, published,
      );
      const pid = Number(info.lastInsertRowid);
      for (const id of v.postIds) linkPost.run(pid, id);
      for (const sid of submissionIds) {
        const sub = db.query(`SELECT supplier_id FROM submissions WHERE id = ?`).get(sid) as any;
        if (!sub) continue;
        linkSubmission.run(pid, sid);
        if (supplierId == null && sub.supplier_id) {
          supplierId = sub.supplier_id;
          db.query(`UPDATE products SET supplier_id = ? WHERE id = ?`).run(supplierId, pid);
        }
      }
      return pid;
    });
    const pid = create();
    if (published && supplierId != null) {
      const s = getSupplier.get(supplierId) as any;
      if (s?.telegram_id) notifySupplier(s.telegram_id, `تم نشر منتجك: ${v.name}`);
    }
    return json({ ok: true, id: pid });
  }

  const prodMatch = p.match(/^\/api\/products\/(\d+)$/);
  if (prodMatch && method === "PATCH") {
    const id = Number(prodMatch[1]);
    const current = db.query(`SELECT * FROM products WHERE id = ?`).get(id) as any;
    if (!current) return json({ error: "not found" }, 404);
    const input = await readBody(req);
    if (input == null || typeof input !== "object" || Array.isArray(input)) {
      return json({ error: "JSON غير صالح" }, 400);
    }
    const body = input as Record<string, unknown>;
    const cur = parseRow(current);
    const merged: Record<string, unknown> = {
      name: body.name ?? cur.name,
      category: body.category ?? cur.category,
      price: body.price ?? cur.price,
      price_on_request: body.price_on_request ?? cur.price_on_request ?? 0,
      stock: body.stock ?? cur.stock,
      moq: body.moq ?? cur.moq,
      description: body.description ?? cur.description,
      images: body.images ?? cur.images,
      contact: body.contact ?? cur.contact,
      contact_type: body.contact_type ?? cur.contact_type,
      source_channel: body.source_channel ?? cur.source_channel,
      specs: body.specs ?? cur.specs,
      post_ids: [],
    };
    const targetPublished = body.published != null
      ? (body.published === 1 || body.published === true ? 1 : 0)
      : cur.published;
    let supplierId: number | null = cur.supplier_id ?? null;
    if (body.supplier_id != null && body.supplier_id !== "") {
      supplierId = Number(body.supplier_id);
      if (!Number.isInteger(supplierId) || supplierId <= 0) return json({ error: "المورّد غير صالح" }, 400);
      if (!getSupplier.get(supplierId)) return json({ error: "المورّد غير موجود" }, 404);
    }
    if (targetPublished && supplierId == null) return json({ error: "المورّد إجباري للنشر" }, 400);
    const result = parseProduct(merged, { categories: config.categories, imageOk }, targetPublished ? "publish" : "draft");
    if (!result.ok) return json({ error: result.error }, 400);
    const v = result.value;
    const save = db.transaction(() => {
      db.query(
        `UPDATE products SET name = ?, category = ?, price = ?, price_on_request = ?, stock = ?, moq = ?, description = ?, images = ?, contact = ?, contact_type = ?, source_channel = ?, specs = ?, supplier_id = ?, published = ? WHERE id = ?`,
      ).run(
        v.name, v.category, v.price, v.priceOnRequest ? 1 : 0, v.stock, v.moq, v.description,
        JSON.stringify(v.images), v.contact, v.contactType, v.sourceChannel,
        JSON.stringify(v.specs), supplierId, targetPublished, id,
      );
    });
    save();
    return json({ ok: true, id });
  }

  if (prodMatch && method === "DELETE") {
    const id = Number(prodMatch[1]);
    const destroy = db.transaction(() => {
      unlinkPosts.run(id);
      unlinkSubmissions.run(id);
      deleteProduct.run(id);
    });
    destroy();
    return json({ ok: true });
  }

  if (p === "/api/posts/status" && method === "POST") {
    const body = await readBody(req);
    if (!body || !["new", "done", "skipped"].includes(body.status) || !Array.isArray(body.ids)) {
      return json({ error: "bad request" }, 400);
    }
    const ids = body.ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0);
    for (const id of ids) setPostStatus.run(body.status, id);
    return json({ ok: true });
  }

  return json({ error: "Not found" }, 404);
}

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  async fetch(req) {
    try {
      const url = new URL(req.url);
      const p = url.pathname;

      if (p === "/healthz") {
        return json({ status: "ok" }, 200, { "Cache-Control": "no-store" });
      }

      if (p.startsWith("/media/")) {
        const name = p.slice("/media/".length);
        const full = safeChild("media", name);
        if (!full) return new Response("Not Found", { status: 404 });
        const isThumb = name.startsWith("thumbs/");
        return (await file(full, isThumb ? "public, max-age=604800" : "public, max-age=3600")) ?? new Response("Not Found", { status: 404 });
      }

      if (p.startsWith("/api/")) return await api(req, url);

      if (p === "/admin" || p === "/admin/") {
        const target = isAuthed(req) ? "admin.html" : "login.html";
        return (await file(`public/${target}`, "no-cache")) ?? new Response("Not Found", { status: 404 });
      }
      if (p === "/login") {
        return (await file("public/login.html", "no-cache")) ?? new Response("Not Found", { status: 404 });
      }
      if (p === "/supplier" || p === "/supplier/") {
        return (await file("public/supplier.html", "no-cache")) ?? new Response("Not Found", { status: 404 });
      }
      if (p === "/about" || p === "/about/") {
        return (await file("public/about.html", "no-cache")) ?? new Response("Not Found", { status: 404 });
      }
      if (p === "/blog" || p === "/blog/") {
        return (await file("public/blog.html", "no-cache")) ?? new Response("Not Found", { status: 404 });
      }
      if (p === "/") {
        return (await file("public/catalog.html", "no-cache")) ?? new Response("Not Found", { status: 404 });
      }

      // channel store page: /c/:slug
      const storeMatch = p.match(/^\/c\/([^/]+)$/);
      if (storeMatch) {
        if (hiddenStores().slugs.has(storeMatch[1]!)) return new Response("Not Found", { status: 404 });
        const row = db.query(`SELECT slug FROM channels WHERE slug = ?`).get(storeMatch[1]);
        if (!row) return new Response("Not Found", { status: 404 });
        return (await file("public/catalog.html", "no-cache")) ?? new Response("Not Found", { status: 404 });
      }

      // product page: /p/:id
      const productMatch = p.match(/^\/p\/(\d+)$/);
      if (productMatch) {
        const row = db.query(`SELECT source_channel FROM products WHERE published = 1 AND id = ?`).get(Number(productMatch[1])) as any;
        if (!row) return new Response("Not Found", { status: 404 });
        if (row.source_channel && hiddenStores().names.has(row.source_channel)) {
          return new Response("Not Found", { status: 404 });
        }
        return (await file("public/product.html", "no-cache")) ?? new Response("Not Found", { status: 404 });
      }

      // static assets under public/ (css, js, fonts, favicon, ...)
      const full = safeChild("public", p.slice(1));
      if (full) {
        const ext = full.slice(full.lastIndexOf(".")).toLowerCase();
        const isFont = ext === ".woff" || ext === ".woff2" || ext === ".ttf" || ext === ".otf";
        const cache = isFont ? "public, max-age=604800" : "no-cache";
        return (await file(full, cache)) ?? new Response("Not Found", { status: 404 });
      }

      return new Response("Not Found", { status: 404 });
    } catch (err) {
      console.error("handler error:", err);
      return json({ error: "internal error" }, 500);
    }
  },
});

console.log(`🛍️  Jemlix catalog → http://${config.host}:${server.port}/`);
console.log(`   Admin → http://${config.host}:${server.port}/admin`);
if (!config.adminToken) console.log("   ⚠️  ADMIN_TOKEN not set — /admin and writes are OPEN (dev only)");
else console.log("   🔒 Admin locked with ADMIN_TOKEN");

// WORKFLOW.md Phase 2: Telegram bot shares this process + DB.
let stopTelegramBot: (() => Promise<void>) | null = null;

if (config.botToken) {
  import("./bot.ts")
    .then((m) => {
      m.startBot();
      stopTelegramBot = m.stopBot;
    })
    .catch((err) => console.error("bot failed to start:", err));
} else {
  console.log("   🤖 BOT_TOKEN not set — dashboard-only mode (manual submissions)");
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`   stopping Jemlix (${signal})`);
  try {
    await stopTelegramBot?.();
    await server.stop(true);
    db.close();
  } catch (err) {
    console.error("shutdown error:", err instanceof Error ? err.message : err);
  } finally {
    process.exit();
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
