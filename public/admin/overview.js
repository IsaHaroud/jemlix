import { $, j, fmtMAD, fmtDate, esc, phaseBadge } from "./shared.js";

export function createOverview({ catalog, suppliers }) {
  let statsCache = null;

  async function loadStats() {
    statsCache = await j("/api/admin/stats");
    renderStats();
    catalog.setStats(statsCache);
  }

  function renderStats() {
    const s = statsCache;
    if (!s) return;
    $("stat-cards").innerHTML = `
      <div class="stat-card"><div class="stat-label">Suppliers</div><div class="stat-num">${s.suppliers.total}</div><div class="stat-sub">${s.suppliers.active} active · ${s.suppliers.pending} pending</div></div>
      <div class="stat-card"><div class="stat-label">Products</div><div class="stat-num">${s.products.published}</div><div class="stat-sub">${s.products.drafts} drafts · ${s.products.total} total</div></div>
      <div class="stat-card"><div class="stat-label">New submissions</div><div class="stat-num">${s.submissions_new}</div><div class="stat-sub">awaiting review</div></div>
      <div class="stat-card"><div class="stat-label">Revenue</div><div class="stat-num">${fmtMAD(s.payments.total_minor)}</div><div class="stat-sub">${s.payments.count} payments</div></div>
      <div class="stat-card"><div class="stat-label">Catalog views</div><div class="stat-num">${s.views.last_7d}</div><div class="stat-sub">${s.views.today} today · last 7 days</div></div>`;
    const box = $("due-list");
    if (!s.attention.length) {
      box.innerHTML = '<div class="muted">Nothing due soon.</div>';
      return;
    }
    box.replaceChildren();
    for (const a of s.attention) {
      const row = document.createElement("div");
      row.className = "due-row";
      const nm = document.createElement("strong");
      nm.textContent = a.name || `#${a.id}`;
      nm.style.cursor = "pointer";
      nm.addEventListener("click", () => suppliers.openSupplier(a.id));
      const badge = document.createElement("span");
      badge.innerHTML = phaseBadge(a.phase);
      const when = document.createElement("span");
      when.className = "muted mono";
      when.textContent = a.phase.startsWith("trial") ? `trial ends ${fmtDate(a.trial_ends_at)}` : `due ${fmtDate(a.next_due_at)}`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ghost";
      btn.textContent = "+30d";
      btn.addEventListener("click", () => suppliers.extendSub(a.id, 30));
      row.append(nm, badge, when);
      const spacer = document.createElement("span");
      spacer.style.flex = "1";
      row.append(spacer, btn);
      box.append(row);
    }
  }

  async function loadPayments() {
    const rows = await j("/api/admin/payments?limit=200");
    const body = $("pay-rows");
    body.replaceChildren();
    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 6;
      td.className = "muted";
      tr.className = "table-empty";
      td.textContent = "No payments yet.";
      tr.append(td);
      body.append(tr);
      return;
    }
    for (const p of rows) {
      const tr = document.createElement("tr");
      const period = [fmtDate(p.period_start), fmtDate(p.period_end)].some((d) => d !== "—")
        ? `${fmtDate(p.period_start)} → ${fmtDate(p.period_end)}`
        : "—";
      tr.innerHTML = `<td class="mono" data-label="ID">#${p.id}</td><td data-label="Supplier">${esc(p.supplier_name || `#${p.supplier_id}`)}</td>
        <td data-label="Amount"><strong>${fmtMAD(p.amount_minor)}</strong></td><td data-label="Method">${esc(p.method || "")}</td>
        <td class="muted mono" data-label="Period">${esc(period)}</td><td class="muted mono" data-label="Date">${esc(fmtDate(p.paid_at))}</td>`;
      tr.addEventListener("click", () => suppliers.openSupplier(p.supplier_id));
      body.append(tr);
    }
  }


  return { loadStats, loadPayments };
}
