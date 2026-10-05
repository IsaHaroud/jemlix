import db from "./db.ts";

export const BILLING_CYCLES = new Set(["monthly", "quarterly", "yearly", "custom"]);
export const BILLING_STATUSES = new Set(["trial", "active", "paused", "churned"]);
export const PAYMENT_METHODS = new Set(["cash", "bank", "wafacash", "cmi", "other"]);
export const PAYMENT_KINDS = new Set(["subscription", "onboarding"]);

function cleanText(value: unknown, max: number): string | null {
  if (value == null) return "";
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length <= max ? text : null;
}

function dateValue(value: unknown): string | null | false {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? false : value;
}

export type SubscriptionInput = {
  plan_name: string;
  amount_minor: number;
  currency: string;
  billing_cycle: string;
  period_start: string | null;
  period_end: string | null;
  next_due_at: string | null;
  grace_days: number;
  status: string;
  trial_ends_at: string | null;
  next_follow_up_at: string | null;
  internal_note: string;
};

export function parseSubscription(input: unknown): { ok: true; value: SubscriptionInput } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Invalid JSON" };
  const body = input as Record<string, unknown>;
  const plan_name = cleanText(body.plan_name, 80);
  const internal_note = cleanText(body.internal_note, 4000);
  const currency = cleanText(body.currency ?? "MAD", 3)?.toUpperCase() ?? null;
  const billing_cycle = cleanText(body.billing_cycle, 16);
  const status = cleanText(body.status, 16);
  const amount_minor = Number(body.amount_minor);
  const grace_days = Number(body.grace_days);
  const period_start = dateValue(body.period_start);
  const period_end = dateValue(body.period_end);
  const next_due_at = dateValue(body.next_due_at);
  const trial_ends_at = dateValue(body.trial_ends_at);
  const next_follow_up_at = dateValue(body.next_follow_up_at);
  if (plan_name == null || internal_note == null || !currency || currency.length !== 3) return { ok: false, error: "Invalid text field" };
  if (!billing_cycle || !BILLING_CYCLES.has(billing_cycle)) return { ok: false, error: "Invalid billing cycle" };
  if (!status || !BILLING_STATUSES.has(status)) return { ok: false, error: "Invalid billing status" };
  if (!Number.isInteger(amount_minor) || amount_minor < 0 || amount_minor > 100_000_000) return { ok: false, error: "Invalid amount" };
  if (!Number.isInteger(grace_days) || grace_days < 0 || grace_days > 90) return { ok: false, error: "Invalid grace period" };
  if ([period_start, period_end, next_due_at, trial_ends_at, next_follow_up_at].includes(false)) return { ok: false, error: "Invalid date" };
  if (period_start && period_end && period_end < period_start) return { ok: false, error: "Period end is before period start" };
  return { ok: true, value: { plan_name, amount_minor, currency, billing_cycle, period_start: period_start || null, period_end: period_end || null, next_due_at: next_due_at || null, grace_days, status, trial_ends_at: trial_ends_at || null, next_follow_up_at: next_follow_up_at || null, internal_note } };
}

export type PaymentInput = {
  amount_minor: number;
  currency: string;
  paid_at: string;
  method: string;
  kind: string;
  external_reference: string;
  note: string;
  period_start: string | null;
  period_end: string | null;
  next_due_at: string | null;
};

export function parsePayment(input: unknown): { ok: true; value: PaymentInput } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Invalid JSON" };
  const body = input as Record<string, unknown>;
  const amount_minor = Number(body.amount_minor);
  const currency = cleanText(body.currency ?? "MAD", 3)?.toUpperCase() ?? null;
  const method = cleanText(body.method, 20);
  const kind = cleanText(body.kind ?? "subscription", 20);
  const external_reference = cleanText(body.external_reference, 120);
  const note = cleanText(body.note, 1000);
  const paid_at = dateValue(body.paid_at);
  const period_start = dateValue(body.period_start);
  const period_end = dateValue(body.period_end);
  const next_due_at = dateValue(body.next_due_at);
  if (!Number.isInteger(amount_minor) || amount_minor <= 0 || amount_minor > 100_000_000) return { ok: false, error: "Invalid amount" };
  if (!currency || currency.length !== 3 || !method || !PAYMENT_METHODS.has(method) || !kind || !PAYMENT_KINDS.has(kind) || external_reference == null || note == null) return { ok: false, error: "Invalid payment data" };
  if (!paid_at || paid_at === false || period_start === false || period_end === false || next_due_at === false) return { ok: false, error: "Invalid date" };
  if (period_start && period_end && period_end < period_start) return { ok: false, error: "Period end is before period start" };
  return { ok: true, value: { amount_minor, currency, paid_at, method, kind, external_reference, note, period_start: period_start || null, period_end: period_end || null, next_due_at: next_due_at || null } };
}

function utcDay(value: string): number {
  return Math.floor(new Date(`${value}T00:00:00Z`).getTime() / 86_400_000);
}

export function billingPhase(subscription: any, today = new Date().toISOString().slice(0, 10)): { phase: string; days_until_due: number | null } {
  if (!subscription) return { phase: "unconfigured", days_until_due: null };
  if (subscription.status === "paused" || subscription.status === "churned") return { phase: subscription.status, days_until_due: null };
  const due = subscription.status === "trial" ? subscription.trial_ends_at : subscription.next_due_at;
  if (!due) return { phase: subscription.status, days_until_due: null };
  const days = utcDay(due) - utcDay(today);
  if (subscription.status === "trial") return { phase: days < 0 ? "trial_ended" : days <= 7 ? "trial_ending" : "trial", days_until_due: days };
  if (days > 7) return { phase: "active", days_until_due: days };
  if (days > 0) return { phase: "due_soon", days_until_due: days };
  if (days === 0) return { phase: "due_today", days_until_due: 0 };
  if (Math.abs(days) <= Number(subscription.grace_days || 0)) return { phase: "grace", days_until_due: days };
  return { phase: "overdue", days_until_due: days };
}

export function addSupplierEvent(supplierId: number, eventType: string, details: unknown = {}, actor = "admin"): void {
  db.query(`INSERT INTO supplier_events (supplier_id, event_type, actor, details) VALUES (?,?,?,?)`)
    .run(supplierId, eventType, actor, JSON.stringify(details ?? {}));
}
