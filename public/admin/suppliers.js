import { $, j, toast, fmtMAD, fmtDate, esc, phaseBadge, supplierStatusBadge, dueText, openModal, closeModal, openDrawer, closeDrawer, go } from "./shared.js";

export function createSuppliers({ catalog, refreshAll }) {
  let suppliers = [];

  function supplierById(id) {
    return suppliers.find((s) => s.id === id);
  }

  function suggestSlug(name) {
    return String(name || "").toLowerCase().trim()
      .replace(/[^a-z0-9\s-]/g, "").replace(/[\s_]+/g, "-").replace(/-+/g, "-")
      .replace(/^-|-$/g, "").slice(0, 60);
  }

  function suppLabel(s) {
    return s.name ? `${s.name} (#${s.id})` : `#${s.id}`;
  }

  async function loadSuppliers() {
    suppliers = await j("/api/suppliers");
    renderSuppliers();
    const curQ = catalog.supplierEl.value;
    catalog.supplierEl.replaceChildren(
      new Option("Select supplier", ""),
      ...suppliers.map((s) => new Option(`${suppLabel(s)} · ${s.status}`, String(s.id))),
      new Option("Unlinked (legacy)", "unlinked"),
    );
    if ([...catalog.supplierEl.options].some((o) => o.value === curQ)) catalog.supplierEl.value = curQ;
    const subSel = $("sub-supplier");
    const subCur = subSel.value;
    subSel.replaceChildren(
      new Option("All suppliers", ""),
      ...suppliers.map((s) => new Option(suppLabel(s), String(s.id))),
    );
    if ([...subSel.options].some((o) => o.value === subCur)) subSel.value = subCur;
    const m = $("m-supplier");
    m.replaceChildren(...suppliers.map((s) => new Option(suppLabel(s), String(s.id))));
    $("m-add").disabled = suppliers.length === 0;
    $("m-no-suppliers").hidden = suppliers.length !== 0;
    const pub = $("pub-supplier");
    const pubCur = pub.value;
    pub.replaceChildren(
      new Option("All suppliers", ""),
      ...suppliers.map((s) => new Option(suppLabel(s), String(s.id))),
      new Option("Unlinked (legacy)", "unlinked"),
    );
    if ([...pub.options].some((o) => o.value === pubCur)) pub.value = pubCur;
  }

  function renderSuppliers() {
    const body = $("supp-rows");
    body.replaceChildren();
    if (!suppliers.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 7;
      td.className = "muted";
      tr.className = "table-empty";
      td.textContent = "No suppliers yet. Add one here or invite one through Telegram.";
      tr.append(td);
      body.append(tr);
      return;
    }
    for (const s of suppliers) {
      const tr = document.createElement("tr");
      tr.addEventListener("click", (event) => {
        if (event.target.closest("a,button")) return;
        openSupplier(s.id);
      });
      const name = document.createElement("td");
      name.dataset.label = "Supplier";
      const strong = document.createElement("div");
      const open = document.createElement("button");
      open.type = "button";
      open.className = "table-row-open";
      open.textContent = s.name || "(no name)";
      open.addEventListener("click", () => openSupplier(s.id));
      strong.append(open);
      const id = document.createElement("span");
      id.className = "muted mono";
      id.textContent = ` #${s.id}`;
      strong.append(id);
      const sub = document.createElement("div");
      sub.className = "muted";
      sub.textContent = `${supplierStatusBadge(s.status).replace(/<[^>]+>/g, "")} · ${s.whatsapp || "no number"}`;
      const identity = document.createElement("div");
      identity.append(strong, sub);
      name.append(identity);
      const chan = document.createElement("td");
      chan.dataset.label = "Channel";
      chan.innerHTML = `<div><div>${esc(s.channel_title || "—")}</div><div class="muted mono">${esc(s.channel_id || "")}</div></div>`;
      const store = document.createElement("td");
      store.dataset.label = "Store";
      store.innerHTML = s.channel_slug ? `<a class="text-link mono" href="/c/${encodeURIComponent(s.channel_slug)}" target="_blank" rel="noopener">/c/${esc(s.channel_slug)}</a>` : '<span class="muted">—</span>';
      const plan = document.createElement("td");
      plan.dataset.label = "Plan";
      plan.innerHTML = `<div>${phaseBadge(s.phase)}<div class="muted">${esc(s.plan_name || "")}</div></div>`;
      const due = document.createElement("td");
      due.dataset.label = "Due";
      due.innerHTML = `<div class="mono">${esc(dueText(s))}</div>`;
      const prods = document.createElement("td");
      prods.dataset.label = "Products";
      prods.textContent = s.product_count ?? 0;
      const paid = document.createElement("td");
      paid.dataset.label = "Paid";
      paid.textContent = fmtMAD(s.total_paid_minor ?? 0);
      tr.append(name, chan, store, plan, due, prods, paid);
      body.append(tr);
    }
  }

  async function openSupplier(id) {
    const sameSupplierOpen = !$('drawer-wrap').hidden && $('drawer-title').dataset.supplierId === String(id);
    const previousScroll = sameSupplierOpen ? $('drawer-body').scrollTop : 0;
    const previousFocusId = sameSupplierOpen ? document.activeElement?.id : null;
    const detail = await j(`/api/suppliers/${id}/detail`).catch((e) => {
      if (e.message !== "auth") toast(e.message, true);
      return null;
    });
    if (!detail) return;
    const { supplier: s, subscription: sub, payments, timeline, summary } = detail;
    openDrawer(`#${s.id} ${s.name || ""}`, supplierStatusBadge(s.status));
    $('drawer-title').dataset.supplierId = String(id);
    const wa = s.whatsapp ? `<a class="mono" target="_blank" href="https://wa.me/${s.whatsapp.replace(/[^0-9]/g, "")}">${esc(s.whatsapp)}</a>` : "—";
    const tg = s.telegram_id ? `<a class="mono" href="tg://user?id=${s.telegram_id}">${esc(String(s.telegram_id))}</a>` : "—";
    const storeLive = s.status === "active" && !!s.channel_slug;
    const stateText = storeLive ? "Store live" : s.status === "active" ? "Add store URL" : s.status === "paused" ? "Store paused" : s.channel_id ? "Ready for review" : "Waiting for channel";
    const stateHelp = storeLive ? "Customers can open this store." : s.status === "active" ? "Set a store slug to give customers a link." : s.status === "paused" ? "Activate the supplier when the store is ready." : s.channel_id ? "Review the store details and activate it." : "Ask the supplier to add the bot as a channel admin.";
    $("drawer-body").innerHTML = `
      <section class="supplier-hero" data-status="${esc(s.status)}" aria-label="Supplier summary">
        <div class="supplier-hero-top">
          <div>
            <span class="supplier-eyebrow">Supplier #${s.id}</span>
            <h2>${esc(s.name || `Supplier #${s.id}`)}</h2>
            <p>${esc(s.channel_title || "No channel linked yet")} · Joined ${fmtDate(s.created_at)}</p>
          </div>
          <span class="supplier-hero-state">${stateText}</span>
        </div>
        <p style="margin-top:11px">${stateHelp}</p>
        <div class="supplier-hero-metrics">
          <div class="supplier-hero-metric"><strong>${summary.published_products}</strong><span>Published products</span></div>
          <div class="supplier-hero-metric"><strong>${fmtMAD(summary.total_paid_minor)}</strong><span>Total paid</span></div>
          <div class="supplier-hero-metric"><strong>${sub ? esc(sub.plan_name || "Plan set") : "No plan"}</strong><span>Subscription</span></div>
        </div>
        <div class="supplier-hero-actions">
          ${s.status !== "active" ? '<button class="primary" id="d-activate" type="button">Activate supplier</button>' : ""}
          ${storeLive ? `<a class="ghost" target="_blank" rel="noopener" href="/c/${encodeURIComponent(s.channel_slug)}">Open store ↗</a>` : ""}
          <button class="ghost" type="button" data-supplier-jump="d-store-section">Store settings</button>
        </div>
      </section>
      <nav class="supplier-detail-nav" aria-label="Supplier sections">
        <button type="button" data-supplier-jump="d-store-section">Store</button>
        <button type="button" data-supplier-jump="d-profile-section">Profile</button>
        <button type="button" data-supplier-jump="d-billing-section">Billing</button>
        <button type="button" data-supplier-jump="d-performance-section">Performance</button>
        <button type="button" data-supplier-jump="d-activity-section">Activity</button>
      </nav>
      <div class="supplier-card-grid">
        <section class="panel supplier-card supplier-card-main" id="d-store-section">
          <div class="supplier-card-head"><h3>Channel &amp; store</h3>${supplierStatusBadge(s.status)}</div>
          <p class="supplier-card-intro">The supplier links their channel by adding the bot as an admin. Set a store URL and status here.</p>
          <div class="supplier-channel">
            <strong>${esc(s.channel_title || "Channel not linked")}</strong>
            <small>${esc(s.channel_id || "No Telegram channel ID yet")}</small>
          </div>
          <div class="fields">
            <label class="stack">Store slug<input id="d-slug" value="${esc(s.channel_slug || "")}" dir="ltr" placeholder="e.g. said-shop"></label>
            <label class="stack">Status
              <select id="d-status">
                <option value="pending">Pending</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </select>
            </label>
          </div>
          <div class="editor-actions">
            <button class="ghost" id="d-suggest" type="button">Use channel name</button>
            <button class="primary" id="d-save-store" type="button">Save store</button>
          </div>
          ${s.channel_slug ? `<p class="supplier-store-hint">Store URL: <a target="_blank" rel="noopener" href="/c/${encodeURIComponent(s.channel_slug)}">/c/${esc(s.channel_slug)} ↗</a></p>` : '<p class="supplier-store-hint">A store URL is needed before customers can visit.</p>'}
        </section>
        <section class="panel supplier-card supplier-card-main" id="d-profile-section">
          <div class="supplier-card-head"><h3>Profile</h3><span class="badge b-gray mono">ID: #${s.id}</span></div>
          <div class="fields">
            <label class="stack">Name<input id="d-name" value="${esc(s.name || "")}"></label>
            <label class="stack">Username<input id="d-user" value="${esc(s.username || "")}" dir="ltr"></label>
            <label class="stack">WhatsApp<input id="d-wa" value="${esc(s.whatsapp || "")}" dir="ltr"></label>
            <label class="stack">Telegram ID<input id="d-tg" value="${esc(s.telegram_id ?? "")}" dir="ltr"></label>
          </div>
          <div class="supplier-card-meta"><span>Telegram ${tg}</span><span>WhatsApp ${wa}</span><span>Since ${fmtDate(s.created_at)}</span><code>--supplier ${s.id}</code></div>
          <div class="editor-actions"><button class="primary" id="d-save-profile" type="button">Save profile</button></div>
        </section>
        <section class="panel supplier-card" id="d-billing-section">
          <div class="supplier-card-head"><h3>Subscription</h3>${sub ? phaseBadge(sub.phase) : ""}</div>
          ${sub ? `<p class="supplier-card-intro">${esc(sub.plan_name || "")} · ${fmtMAD(sub.amount_minor)}/${esc(sub.billing_cycle || "")} · ${dueText({ ...sub })}</p>` : '<p class="supplier-card-intro">No subscription yet.</p>'}
          <div class="editor-actions">
            <button class="ghost" id="d-plan" type="button">Set plan</button>
            <button class="ghost" id="d-trial" type="button">Start 14-day trial</button>
            <button class="ghost" id="d-pay" type="button">Record payment</button>
          </div>
        </section>
        <section class="panel supplier-card">
          <div class="supplier-card-head"><h3>Catalog build (onboarding)</h3></div>
          <p class="supplier-card-intro">Pay-first flow: record his estimate now, reconcile the exact count after the build.</p>
          <div class="fields">
            <label class="stack">Rate (MAD / product)<input id="d-rate" type="number" min="0" value="2"></label>
            <label class="stack">Published products<input value="${summary.published_products}" disabled></label>
          </div>
          <div id="d-build-math" class="supplier-card-meta"></div>
          <div class="editor-actions">
            <button class="ghost" id="d-estimate" type="button">Record estimate upfront</button>
            <button class="primary" id="d-balance" type="button">Record balance</button>
          </div>
        </section>
        <section class="panel supplier-card" id="d-performance-section">
          <div class="supplier-card-head"><h3>Analytics (last 30 days)</h3></div>
          <div id="d-analytics"><div class="muted">Loading…</div></div>
        </section>
        <section class="panel supplier-card">
          <div class="supplier-card-head"><h3>Products · ${summary.products} (${summary.published_products} published)</h3></div>
          <div class="editor-actions">
            <button class="ghost" id="d-products" type="button">View products</button>
            <button class="ghost" id="d-queue" type="button">Open queue</button>
          </div>
        </section>
        <section class="panel supplier-card">
          <div class="supplier-card-head"><h3>Payments (${payments.length}) · total ${fmtMAD(summary.total_paid_minor)}</h3></div>
          <div>${payments.map((p) => `<div class="due-row"><strong>${fmtMAD(p.amount_minor)}</strong><span class="badge ${p.kind === "onboarding" ? "b-blue" : "b-green"}">${p.kind === "onboarding" ? "build" : "sub"}</span><span class="badge b-gray">${esc(p.method || "")}</span><span class="grow" style="flex:1"></span><span class="muted mono">${fmtDate(p.paid_at)}</span></div>`).join("") || '<div class="muted">No payments.</div>'}</div>
        </section>
        <section class="panel supplier-card supplier-card-danger" id="d-activity-section">
          <div class="supplier-card-head"><h3>Notes &amp; timeline</h3></div>
          <div class="fields"><label class="stack span-2">Add note<textarea id="d-note" rows="2"></textarea></label></div>
          <div class="editor-actions">
            <button class="ghost" id="d-note-save" type="button">Save note</button>
            <button class="ghost" id="d-revoke" type="button">Revoke supplier sessions</button>
          </div>
          <div style="margin-top:12px">${timeline.map((e) => `<div class="due-row"><span class="badge b-gray">${esc(e.event_type)}</span><span class="muted">${esc(e.actor || "")}</span><span class="grow" style="flex:1"></span><span class="muted mono">${fmtDate(e.created_at)}</span></div>`).join("") || '<div class="muted">No events.</div>'}</div>
        </section>
      </div>`;
    $('drawer-body').scrollTop = previousScroll;
    if (previousFocusId && $(previousFocusId)) $(previousFocusId).focus({ preventScroll: true });
    $("d-status").value = s.status;
    const jumpTo = (sectionId) => $(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    for (const button of $('drawer-body').querySelectorAll('[data-supplier-jump]')) {
      button.addEventListener('click', () => jumpTo(button.dataset.supplierJump));
    }
    const navButtons = [...$('drawer-body').querySelectorAll('.supplier-detail-nav [data-supplier-jump]')];
    const syncNavigation = () => {
      const body = $('drawer-body');
      const navBottom = body.querySelector('.supplier-detail-nav').getBoundingClientRect().bottom + 24;
      let current = navButtons[0]?.dataset.supplierJump;
      for (const button of navButtons) {
        if ($(button.dataset.supplierJump).getBoundingClientRect().top <= navBottom) current = button.dataset.supplierJump;
      }
      if (body.scrollTop + body.clientHeight >= body.scrollHeight - 4) current = navButtons.at(-1)?.dataset.supplierJump;
      for (const button of navButtons) {
        if (button.dataset.supplierJump === current) button.setAttribute('aria-current', 'location');
        else button.removeAttribute('aria-current');
      }
    };
    $('drawer-body').onscroll = syncNavigation;
    requestAnimationFrame(syncNavigation);
    const buildMath = () => {
      const rate = Number($("d-rate").value || 0);
      const exact = Math.round(summary.published_products * rate * 100);
      const paid = summary.onboarding_paid_minor || 0;
      const remaining = exact - paid;
      $("d-build-math").innerHTML =
        `Exact: <strong>${fmtMAD(exact)}</strong> (${summary.published_products} products × ${rate} MAD) · ` +
        `paid: <strong>${fmtMAD(paid)}</strong> · ` +
        (remaining > 0 ? `remaining: <strong>${fmtMAD(remaining)}</strong>` : `<strong>Settled ✓</strong>`);
      return { rate, exact, paid, remaining };
    };
    buildMath();
    $("d-rate").addEventListener("input", buildMath);
    $("d-estimate").addEventListener("click", () => {
      const { rate } = buildMath();
      openPaymentModal(id, { kind: "onboarding", amount: "", note: `Upfront estimate (~${summary.published_products} products × ${rate} MAD)` });
    });
    $("d-balance").addEventListener("click", () => {
      const { rate, exact, paid, remaining } = buildMath();
      if (remaining <= 0) {
        toast("Nothing remaining — settled");
        return;
      }
      openPaymentModal(id, {
        kind: "onboarding",
        amount: remaining / 100,
        note: `Catalog build balance: ${summary.published_products} products × ${rate} MAD = ${fmtMAD(exact)} (paid ${fmtMAD(paid)})`,
      });
    });
    loadDrawerAnalytics(id);
    $("d-save-profile").addEventListener("click", async () => {
      try {
        await j(`/api/suppliers/${id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: $("d-name").value.trim(),
            username: $("d-user").value.trim(),
            whatsapp: $("d-wa").value.trim(),
            telegram_id: $("d-tg").value.trim(),
          }),
        });
        toast("Profile saved");
        await refreshAll();
        openSupplier(id);
      } catch (e) { if (e.message !== "auth") toast(e.message, true); }
    });
    $("d-suggest").addEventListener("click", () => {
      const sug = suggestSlug(s.channel_title || s.name);
      if (sug) $("d-slug").value = sug;
      else toast("No channel name to base the slug on", true);
    });
    const focusStoreSetup = () => {
      $("d-slug").focus({ preventScroll: true });
      $("d-save-store").scrollIntoView({ behavior: "smooth", block: "center" });
    };
    const saveStore = async (status = $("d-status").value) => {
      const slug = $("d-slug").value.trim().toLowerCase();
      if (status === "active" && !slug) {
        focusStoreSetup();
        toast("Add a store slug before activating", true);
        return;
      }
      try {
        await j(`/api/suppliers/${id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel_slug: slug, status }),
        });
        toast("Store saved");
        await refreshAll();
        openSupplier(id);
      } catch (e) { if (e.message !== "auth") toast(e.message, true); }
    };
    $("d-save-store").addEventListener("click", () => saveStore());
    $("d-activate")?.addEventListener("click", () => {
      $("d-status").value = "active";
      if (!$("d-slug").value.trim()) {
        const suggested = suggestSlug(s.channel_title || s.name);
        if (suggested) $("d-slug").value = suggested;
        focusStoreSetup();
        toast("Review the store slug, then tap Save store to activate");
        return;
      }
      saveStore("active");
    });
    $("d-plan").addEventListener("click", () => openSubscriptionModal(id, sub));
    $("d-trial").addEventListener("click", () => startTrial(id));
    $("d-pay").addEventListener("click", () => openPaymentModal(id));
    $("d-products").addEventListener("click", () => {
      closeDrawer();
      go("products");
      $("pub-supplier").value = String(id);
      catalog.loadPublished().catch((e) => toast(e.message, true));
    });
    $("d-queue").addEventListener("click", () => {
      closeDrawer();
      go("queue");
      catalog.supplierEl.value = String(id);
      catalog.loadPosts(true).catch((e) => toast(e.message, true));
    });
    $("d-note-save").addEventListener("click", async () => {
      const text = $("d-note").value.trim();
      if (!text) return;
      try {
        await j(`/api/suppliers/${id}/notes`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        toast("Note saved");
        openSupplier(id);
      } catch (e) { if (e.message !== "auth") toast(e.message, true); }
    });
    $("d-revoke").addEventListener("click", async () => {
      try {
        const r = await j(`/api/suppliers/${id}/revoke-sessions`, { method: "POST" });
        toast(`Revoked ${r.revoked} sessions`);
        openSupplier(id);
      } catch (e) { if (e.message !== "auth") toast(e.message, true); }
    });
  }

  async function loadDrawerAnalytics(id) {
    const box = $("d-analytics");
    if (!box) return;
    try {
      const a = await j(`/api/suppliers/${id}/analytics?days=30`);
      const last14 = a.by_day.slice(-14);
      const max = Math.max(1, ...last14.map((d) => Number(d.views || 0)));
      box.innerHTML = `
        <div class="muted">Today <strong>${a.today}</strong> · 30d total <strong>${a.total}</strong></div>
        <div class="bars" style="margin-top:8px">${last14.map((d) =>
          `<div style="height:${Math.max(6, Math.round((Number(d.views || 0) / max) * 52))}px" title="${d.day}: ${d.views}"></div>`).join("")}</div>
        <div style="margin-top:8px">${a.top_products.slice(0, 5).map((p) =>
          `<div class="due-row"><span>${esc(p.name)}</span><span class="grow" style="flex:1"></span><strong>${p.views}</strong></div>`).join("") || '<div class="muted">No product views yet.</div>'}</div>`;
    } catch {
      box.innerHTML = '<div class="muted">Analytics unavailable.</div>';
    }
  }

  function openSupplierModal() {
    openModal("Add supplier", `
      <div class="fields">
        <label class="stack">Name<input id="ns-name" placeholder="Shop name"></label>
        <label class="stack">WhatsApp<input id="ns-wa" placeholder="0612345678" dir="ltr"></label>
        <label class="stack">Store slug<input id="ns-slug" placeholder="said-shop" dir="ltr"></label>
        <label class="stack">Telegram ID (optional)<input id="ns-tg" placeholder="123456789" dir="ltr"></label>
      </div>
      <div class="editor-actions" style="margin-top:12px">
        <button class="primary" id="ns-save" type="button">Create</button>
      </div>
      <p class="muted">Usually suppliers self-register via the Telegram bot. Manual creation is for migration.</p>`);
    $("ns-save").addEventListener("click", async () => {
      try {
        const r = await j("/api/suppliers", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: $("ns-name").value.trim(),
            whatsapp: $("ns-wa").value.trim(),
            channel_slug: $("ns-slug").value.trim().toLowerCase(),
            telegram_id: $("ns-tg").value.trim(),
            status: "pending",
          }),
        });
        closeModal();
        toast("Supplier created");
        await refreshAll();
        openSupplier(r.id);
      } catch (e) { if (e.message !== "auth") toast(e.message, true); }
    });
  }

  function subFormHtml(sub) {
    const v = (k, d = "") => sub?.[k] ?? d;
    return `
      <div class="fields">
        <label class="stack">Plan name<input id="sb-plan" value="${esc(v("plan_name", "Standard"))}"></label>
        <label class="stack">Status
          <select id="sb-status">
            ${["trial", "active", "paused", "churned"].map((s) => `<option value="${s}">${s}</option>`).join("")}
          </select>
        </label>
        <label class="stack">Amount (MAD)<input id="sb-amount" type="number" min="0" value="${sub ? Math.round((sub.amount_minor || 0) / 100) : ""}"></label>
        <label class="stack">Billing cycle
          <select id="sb-cycle">
            ${["monthly", "quarterly", "yearly", "custom"].map((s) => `<option value="${s}">${s}</option>`).join("")}
          </select>
        </label>
        <label class="stack">Period start<input id="sb-ps" type="date" value="${esc(v("period_start") || "")}"></label>
        <label class="stack">Period end<input id="sb-pe" type="date" value="${esc(v("period_end") || "")}"></label>
        <label class="stack">Next due<input id="sb-due" type="date" value="${esc(v("next_due_at") || "")}"></label>
        <label class="stack">Trial ends<input id="sb-trial" type="date" value="${esc(v("trial_ends_at") || "")}"></label>
        <label class="stack">Grace days<input id="sb-grace" type="number" min="0" max="90" value="${sub?.grace_days ?? 3}"></label>
        <label class="stack">Follow up<input id="sb-fu" type="date" value="${esc(v("next_follow_up_at") || "")}"></label>
        <label class="stack span-2">Internal note<textarea id="sb-note" rows="2">${esc(v("internal_note") || "")}</textarea></label>
      </div>
      <div class="editor-actions" style="margin-top:12px">
        <button class="primary" id="sb-save" type="button">Save subscription</button>
      </div>`;
  }

  function openSubscriptionModal(id, sub) {
    openModal("Subscription", subFormHtml(sub));
    $("sb-status").value = sub?.status || "trial";
    $("sb-cycle").value = sub?.billing_cycle || "monthly";
    $("sb-save").addEventListener("click", async () => {
      const dh = Number($("sb-amount").value || 0);
      try {
        await j(`/api/suppliers/${id}/subscription`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan_name: $("sb-plan").value.trim(),
            amount_minor: Math.round(dh * 100),
            currency: "MAD",
            billing_cycle: $("sb-cycle").value,
            period_start: $("sb-ps").value || null,
            period_end: $("sb-pe").value || null,
            next_due_at: $("sb-due").value || null,
            grace_days: Number($("sb-grace").value || 0),
            status: $("sb-status").value,
            trial_ends_at: $("sb-trial").value || null,
            next_follow_up_at: $("sb-fu").value || null,
            internal_note: $("sb-note").value,
          }),
        });
        closeModal();
        toast("Subscription saved");
        await refreshAll();
        openSupplier(id);
      } catch (e) { if (e.message !== "auth") toast(e.message, true); }
    });
  }

  async function startTrial(id) {
    const in14 = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
    try {
      await j(`/api/suppliers/${id}/subscription`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_name: "Trial", amount_minor: 0, currency: "MAD", billing_cycle: "monthly",
          period_start: null, period_end: null, next_due_at: null, grace_days: 3,
          status: "trial", trial_ends_at: in14, next_follow_up_at: null, internal_note: "",
        }),
      });
      toast("14-day trial started");
      await refreshAll();
      openSupplier(id);
    } catch (e) { if (e.message !== "auth") toast(e.message, true); }
  }

  async function extendSub(id, days) {
    const detail = await j(`/api/suppliers/${id}/detail`).catch(() => null);
    if (!detail?.subscription) {
      toast("Set a subscription first", true);
      return;
    }
    const sub = detail.subscription;
    const base = sub.next_due_at || new Date().toISOString().slice(0, 10);
    const next = new Date(new Date(`${base}T00:00:00Z`).getTime() + days * 864e5).toISOString().slice(0, 10);
    try {
      await j(`/api/suppliers/${id}/subscription`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...sub, next_due_at: next }),
      });
      toast(`Extended +${days}d`);
      await refreshAll();
    } catch (e) { if (e.message !== "auth") toast(e.message, true); }
  }

  function openPaymentModal(presetSupplier = "", preset = {}) {
    if (!suppliers.length) {
      go("suppliers");
      toast("Add a supplier before recording a payment", true);
      return;
    }
    const opts = suppliers.map((s) => `<option value="${s.id}">${esc(s.name || `#${s.id}`)}</option>`).join("");
    const today = new Date().toISOString().slice(0, 10);
    openModal(preset.kind === "onboarding" ? "Record catalog-build payment" : "Record payment", `
      <div class="fields">
        <label class="stack">Supplier
          <select id="pm-sup">${opts}</select>
        </label>
        <label class="stack">Kind
          <select id="pm-kind">
            <option value="subscription">Subscription</option>
            <option value="onboarding">Catalog build</option>
          </select>
        </label>
        <label class="stack">Amount (MAD)<input id="pm-amount" type="number" min="1" placeholder="500" value="${preset.amount ?? ""}"></label>
        <label class="stack">Method
          <select id="pm-method"><option>cash</option><option>bank</option><option>wafacash</option><option>cmi</option><option>other</option></select>
        </label>
        <label class="stack">Paid on<input id="pm-date" type="date" value="${today}"></label>
        <label class="stack">Reference (optional)<input id="pm-ref" placeholder=""></label>
        <label class="stack span-2">Note (optional)<input id="pm-note" placeholder="" value="${esc(preset.note ?? "")}"></label>
        <label class="check span-2">Extend 30 days from paid date
          <input id="pm-extend" type="checkbox" ${preset.kind === "onboarding" ? "" : "checked"}>
        </label>
      </div>
      <div class="editor-actions" style="margin-top:12px">
        <button class="primary" id="pm-save" type="button">Record payment</button>
      </div>
      <p class="muted">Upfront estimates go in as Catalog build payments — reconcile the exact count after the build.</p>`);
    if (presetSupplier) $("pm-sup").value = String(presetSupplier);
    if (preset.kind) $("pm-kind").value = preset.kind;
    $("pm-save").addEventListener("click", async () => {
      const sid = Number($("pm-sup").value);
      const dh = Number($("pm-amount").value || 0);
      const paid = $("pm-date").value;
      if (!sid || !dh || !paid) {
        toast("Supplier, amount and date are required", true);
        return;
      }
      const extend = $("pm-extend").checked && $("pm-kind").value === "subscription";
      const end = extend ? new Date(new Date(`${paid}T00:00:00Z`).getTime() + 30 * 864e5).toISOString().slice(0, 10) : null;
      try {
        await j(`/api/suppliers/${sid}/payments`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount_minor: Math.round(dh * 100),
            currency: "MAD",
            paid_at: paid,
            method: $("pm-method").value,
            kind: $("pm-kind").value,
            external_reference: $("pm-ref").value.trim(),
            note: $("pm-note").value.trim(),
            period_start: extend ? paid : null,
            period_end: end,
            next_due_at: end,
          }),
        });
        closeModal();
        toast("Payment recorded");
        await refreshAll();
      } catch (e) { if (e.message !== "auth") toast(e.message, true); }
    });
  }

  function init() {
    $("supp-add").addEventListener("click", openSupplierModal);
    $("pay-add").addEventListener("click", () => openPaymentModal());
  }

  function list() { return suppliers; }
  return { init, list, supplierById, loadSuppliers, openSupplier, extendSub };
}
