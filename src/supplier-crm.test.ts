import { expect, test } from "bun:test";
import { billingPhase, parsePayment, parseSubscription } from "./supplier-crm.ts";

test("billing phases include due, grace and overdue", () => {
  const base = { status: "active", next_due_at: "2026-10-10", grace_days: 3 };
  expect(billingPhase(base, "2026-10-05").phase).toBe("due_soon");
  expect(billingPhase(base, "2026-10-12").phase).toBe("grace");
  expect(billingPhase(base, "2026-10-15").phase).toBe("overdue");
});

test("subscription and payment validation", () => {
  expect(parseSubscription({ plan_name: "Pro", amount_minor: 30000, currency: "MAD", billing_cycle: "monthly", grace_days: 3, status: "active" }).ok).toBe(true);
  expect(parseSubscription({ amount_minor: -1, billing_cycle: "weekly", grace_days: 3, status: "active" }).ok).toBe(false);
  expect(parsePayment({ amount_minor: 30000, paid_at: "2026-09-29", method: "cash" }).ok).toBe(true);
  expect(parsePayment({ amount_minor: 0, paid_at: "bad", method: "cash" }).ok).toBe(false);
});
