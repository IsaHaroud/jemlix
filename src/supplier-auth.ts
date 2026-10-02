import { createHmac, randomBytes, randomInt } from "node:crypto";
import db from "./db.ts";
import { config } from "./config.ts";

export const SUPPLIER_CODE_TTL_MS = 10 * 60 * 1000;
export const SUPPLIER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SupplierSession = {
  id: number;
  telegram_id: number;
  name: string;
  whatsapp: string;
  channel_title: string;
  channel_slug: string;
  status: string;
};

function auditAccess(supplierId: number, eventType: string, details: unknown = {}, actor = "supplier"): void {
  db.query(`INSERT INTO supplier_events (supplier_id, event_type, actor, details) VALUES (?,?,?,?)`)
    .run(supplierId, eventType, actor, JSON.stringify(details));
}

function authSecret(): string {
  const secret = config.supplierAuthSecret || config.botToken || config.adminToken;
  if (!secret) throw new Error("SUPPLIER_AUTH_SECRET or BOT_TOKEN is required");
  return secret;
}

export function supplierSecretHash(value: string): string {
  return createHmac("sha256", authSecret()).update(value).digest("hex");
}

export function isSupplierCode(value: unknown): value is string {
  return typeof value === "string" && /^\d{6}$/.test(value.trim());
}

function linkLegacyProducts(supplierId: number, channelTitle: string): void {
  if (!channelTitle) return;
  const other = db
    .query(`SELECT id FROM suppliers WHERE channel_title = ? AND id != ? LIMIT 1`)
    .get(channelTitle, supplierId);
  if (other) return;
  db.query(
    `UPDATE products SET supplier_id = ? WHERE supplier_id IS NULL AND source_channel = ?`,
  ).run(supplierId, channelTitle);
}

export function createSupplierLoginCode(supplier: SupplierSession): string {
  if (supplier.status !== "active") throw new Error("supplier is not active");
  const now = Date.now();
  linkLegacyProducts(supplier.id, supplier.channel_title);
  db.query(`UPDATE supplier_login_codes SET used_at = ? WHERE supplier_id = ? AND used_at IS NULL`).run(now, supplier.id);
  db.query(`DELETE FROM supplier_login_codes WHERE expires_at < ?`).run(now - SUPPLIER_CODE_TTL_MS);

  for (let i = 0; i < 20; i += 1) {
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const hash = supplierSecretHash(code);
    try {
      db.query(
        `INSERT INTO supplier_login_codes (supplier_id, code_hash, expires_at, created_at) VALUES (?,?,?,?)`,
      ).run(supplier.id, hash, now + SUPPLIER_CODE_TTL_MS, now);
      auditAccess(supplier.id, "access_code_generated", { expires_in_minutes: SUPPLIER_CODE_TTL_MS / 60_000 });
      return code;
    } catch {
      // Extremely unlikely active-code collision; generate another code.
    }
  }
  throw new Error("could not generate supplier code");
}

export function exchangeSupplierCode(code: string): { token: string; supplier: SupplierSession } | null {
  if (!isSupplierCode(code)) return null;
  const now = Date.now();
  const hash = supplierSecretHash(code.trim());
  const token = randomBytes(32).toString("base64url");
  const tokenHash = supplierSecretHash(token);

  const exchange = db.transaction(() => {
    const row = db.query(
      `SELECT c.id AS code_id, c.attempts, s.*
       FROM supplier_login_codes c
       JOIN suppliers s ON s.id = c.supplier_id
       WHERE c.code_hash = ? AND c.used_at IS NULL AND c.expires_at >= ?`,
    ).get(hash, now) as (SupplierSession & { code_id: number; attempts: number }) | null;
    if (!row || row.status !== "active" || row.attempts >= 5) return null;

    const used = db.query(
      `UPDATE supplier_login_codes SET used_at = ? WHERE id = ? AND used_at IS NULL`,
    ).run(now, row.code_id);
    if (used.changes !== 1) return null;

    db.query(
      `INSERT INTO supplier_sessions (supplier_id, token_hash, expires_at, created_at, last_used_at)
       VALUES (?,?,?,?,?)`,
    ).run(row.id, tokenHash, now + SUPPLIER_SESSION_TTL_MS, now, now);
    auditAccess(row.id, "supplier_login", { session_days: SUPPLIER_SESSION_TTL_MS / 86_400_000 });
    linkLegacyProducts(row.id, row.channel_title);
    return row;
  });

  const supplier = exchange();
  return supplier ? { token, supplier } : null;
}

export function supplierFromSessionToken(token: string | null): SupplierSession | null {
  if (!token || token.length < 32) return null;
  const now = Date.now();
  const row = db.query(
    `SELECT s.*
     FROM supplier_sessions x
     JOIN suppliers s ON s.id = x.supplier_id
     WHERE x.token_hash = ? AND x.revoked_at IS NULL AND x.expires_at >= ? AND s.status = 'active'`,
  ).get(supplierSecretHash(token), now) as SupplierSession | null;
  if (!row) return null;
  db.query(`UPDATE supplier_sessions SET last_used_at = ? WHERE token_hash = ?`).run(now, supplierSecretHash(token));
  return row;
}

export function revokeSupplierSession(token: string | null): void {
  if (!token) return;
  const tokenHash = supplierSecretHash(token);
  const row = db.query(`SELECT supplier_id FROM supplier_sessions WHERE token_hash = ? AND revoked_at IS NULL`).get(tokenHash) as any;
  db.query(`UPDATE supplier_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`)
    .run(Date.now(), tokenHash);
  if (row?.supplier_id) auditAccess(row.supplier_id, "supplier_logout");
}

export function revokeAllSupplierSessions(supplierId: number, actor = "supplier"): number {
  const now = Date.now();
  db.query(`UPDATE supplier_login_codes SET used_at = ? WHERE supplier_id = ? AND used_at IS NULL`).run(now, supplierId);
  const info = db.query(
    `UPDATE supplier_sessions SET revoked_at = ? WHERE supplier_id = ? AND revoked_at IS NULL`,
  ).run(now, supplierId);
  auditAccess(supplierId, "sessions_revoked", { revoked: info.changes }, actor);
  return info.changes;
}
