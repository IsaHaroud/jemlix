import { displayName, isSubstantialName, mediaUrl, priceLabel, suggestedName, thumbUrl } from "./format.js";

const $ = (id) => document.getElementById(id);

// ---------- helpers ----------
async function j(url, opts) {
  const res = await fetch(url, opts);
  if (res.status === 401) {
    location.href = "/login";
    throw new Error("auth");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function toast(msg, isErr = false) {
  const d = document.createElement("div");
  d.className = "toast" + (isErr ? " err" : "");
  d.textContent = msg;
  $("toasts").append(d);
  setTimeout(() => d.remove(), 3200);
}

function fmtMAD(minor) {
  if (minor == null) return "—";
  return `${Number(minor / 100).toLocaleString("en-US").replace(/\.00$/, "")} MAD`;
}

function fmtDate(v) {
  return (v || "").slice(0, 10) || "—";
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function phaseBadge(phase) {
  const map = {
    active: ["b-green", "Active"], trial: ["b-blue", "Trial"],
    trial_ending: ["b-yellow", "Trial ending"], trial_ended: ["b-red", "Trial ended"],
    due_soon: ["b-yellow", "Due soon"], due_today: ["b-yellow", "Due today"],
    grace: ["b-yellow", "Grace"], overdue: ["b-red", "Overdue"],
    paused: ["b-gray", "Paused"], churned: ["b-gray", "Churned"],
    unconfigured: ["b-gray", "No plan"],
  };
  const [cls, label] = map[phase] || ["b-gray", phase || "—"];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

function supplierStatusBadge(status) {
  const map = { active: ["b-green", "Active"], pending: ["b-yellow", "Pending"], paused: ["b-red", "Paused"] };
  const [cls, label] = map[status] || ["b-gray", status || "—"];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

function dueText(s) {
  if (s.phase === "trial" || s.phase === "trial_ending" || s.phase === "trial_ended") {
    return `trial ends ${fmtDate(s.trial_ends_at)}`;
  }
  if (s.next_due_at) return `due ${fmtDate(s.next_due_at)}`;
  return "no due date";
}

function fallBack(img) {
  img.addEventListener("error", () => {
    const full = img.dataset.full;
    if (full && img.getAttribute("src") !== full) img.src = full;
  });
}

function thumb(file) {
  const img = document.createElement("img");
  img.alt = "";
  img.loading = "lazy";
  img.src = thumbUrl(file);
  img.dataset.full = mediaUrl(file);
  fallBack(img);
  return img;
}

// ---------- modal + drawer ----------
function openModal(title, html) {
  $("modal-title").textContent = title;
  $("modal-body").innerHTML = html;
  $("modal-wrap").hidden = false;
}
function closeModal() {
  $("modal-wrap").hidden = true;
}

function openDrawer(title, statusHtml) {
  $("drawer-title").textContent = title;
  $("drawer-status").innerHTML = statusHtml || "";
  $("drawer-body").innerHTML = "Loading…";
  $("drawer-wrap").hidden = false;
}
function closeDrawer() {
  $("drawer-wrap").hidden = true;
}

// ---------- nav ----------
const PAGES = ["overview", "queue", "products", "subs", "suppliers", "payments"];
const PAGE_TITLES = { overview: "Overview", queue: "Review queue", products: "Products", subs: "Submissions", suppliers: "Suppliers", payments: "Payments" };

function go(page) {
  for (const p of PAGES) {
    const sec = $(`page-${p}`);
    if (sec) sec.hidden = p !== page;
  }
  for (const btn of document.querySelectorAll("[data-page]")) {
    const on = btn.dataset.page === page;
    btn.classList.toggle("active", on);
    if (btn.classList.contains("chip")) btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  $("page-title").textContent = PAGE_TITLES[page] || page;
}

// ---------- shared state ----------
const supplierEl = $("supplier");
const statusEl = $("status");
const channelEl = $("channel");
const queryEl = $("q");
const queueEl = $("queue");
const moreEl = $("more");
const selCount = $("sel-count");
const noteEl = $("queue-note");
const countsEl = $("counts");
const publishedEl = $("published");
const emptyEl = $("empty");
const editor = $("editor");
const formError = $("form-error");
const preview = $("preview");

const selected = new Map();
let loaded = [];
let offset = 0;
let total = 0;
let counts = { new: 0, done: 0, skipped: 0 };
let publishedCount = 0;
let cfg = { defaultWhatsapp: "", defaultChannel: "" };
let selImages = [];
let contactType = "whatsapp";
let contactVal = "";
let specs = [];
let tiers = [];
let imgOffset = 0;
let imgTotal = 0;
let imgQuery = "";
let imgTimer = 0;
let queryTimer = 0;
let saving = false;
let suppliers = [];
let subs = [];
let subsOffset = 0;
let subsTotal = 0;
let pendingSubmissionIds = [];
let pendingSupplierId = null;
let editingId = null;
let lastPublished = [];
let statsCache = null;

function setNote(text) {
  noteEl.hidden = !text;
  noteEl.textContent = text || "";
}

function resetEditorState() {
  selected.clear();
  pendingSubmissionIds = [];
  pendingSupplierId = null;
  editingId = null;
  tiers = [];
  renderTiers();
  $("edit-badge").hidden = true;
  $("publish").textContent = "Publish";
}

function renderCounts() {
  countsEl.textContent = `New ${counts.new} · Published ${publishedCount}`;
}

function renderSelection() {
  selCount.textContent = `${selected.size} selected`;
}

// ---------- queue ----------
function renderQueue() {
  queueEl.replaceChildren();
  for (const post of loaded) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "q-item";
    if (selected.has(post.id)) button.classList.add("sel");
    if (post.status === "done") button.classList.add("done");
    if (post.status === "skipped") button.classList.add("skipped");
    button.addEventListener("click", () => toggle(post));

    const tick = document.createElement("span");
    tick.className = "tick";
    const text = document.createElement("span");
    text.className = "q-copy";
    const line = document.createElement("span");
    line.className = "q-text";
    const raw = (post.text || "").trim();
    line.textContent = raw ? raw.slice(0, 90) : "(no text)";
    const meta = document.createElement("span");
    meta.className = "q-meta";
    const state = post.status === "done" ? "published" : post.status === "skipped" ? "skipped" : "";
    meta.textContent = [post.date?.slice(0, 10) || "", state].filter(Boolean).join(" · ");
    text.append(line, meta);

    button.append(tick);
    if (post.image) {
      const img = thumb(post.image);
      img.className = "q-img";
      button.append(img);
    } else {
      const blank = document.createElement("span");
      blank.className = "q-img blank";
      button.append(blank);
    }
    button.append(text);
    queueEl.append(button);
  }
  moreEl.hidden = loaded.length >= total;
  moreEl.textContent = `Show more (${Math.max(total - loaded.length, 0)} left)`;
}

function toggle(post) {
  if (selected.has(post.id)) selected.delete(post.id);
  else selected.set(post.id, post);
  renderSelection();
  renderQueue();
}

async function loadPosts(reset) {
  if (reset) {
    offset = 0;
    loaded = [];
  }
  if (!supplierEl.value) {
    total = 0;
    renderQueue();
    renderSelection();
    setNote("Select a supplier to see their posts");
    return;
  }
  setNote("");
  const params = new URLSearchParams({
    supplier_id: supplierEl.value,
    status: statusEl.value,
    channel: channelEl.value,
    q: queryEl.value.trim(),
    offset: String(offset),
    limit: "40",
  });
  const data = await j(`/api/posts?${params}`);
  counts = data.counts || counts;
  total = data.total || 0;
  loaded = reset ? data.items || [] : loaded.concat(data.items || []);
  offset = loaded.length;
  renderQueue();
  renderSelection();
  renderCounts();
}

async function loadChannels() {
  const channels = await j("/api/channels");
  const current = channelEl.value;
  channelEl.replaceChildren(new Option("All channels", ""));
  for (const ch of channels) channelEl.append(new Option(ch.name, ch.name));
  channelEl.value = channels.some((ch) => ch.name === current) ? current : "";
  renderChannels(channels);
}

function renderChannels(list) {
  const box = $("channels");
  box.replaceChildren();
  for (const ch of list) {
    const row = document.createElement("div");
    row.className = "chan";
    const name = document.createElement("span");
    name.className = "chan-name";
    name.textContent = ch.name;
    const prefix = document.createElement("span");
    prefix.className = "chan-prefix";
    prefix.textContent = "/c/";
    const input = document.createElement("input");
    input.value = ch.slug;
    input.placeholder = "slug";
    input.setAttribute("aria-label", `Slug for ${ch.name}`);
    const save = document.createElement("button");
    save.type = "button";
    save.className = "ghost";
    save.textContent = "Save";
    save.addEventListener("click", () => saveSlug(ch.name, input));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveSlug(ch.name, input);
      }
    });
    const count = document.createElement("span");
    count.className = "muted";
    count.textContent = `${ch.count} products`;
    const link = document.createElement("a");
    link.className = "text-link";
    link.href = `/c/${encodeURIComponent(ch.slug)}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "↗";
    row.append(name, prefix, input, save, count, link);
    box.append(row);
  }
}

async function saveSlug(name, input) {
  const slug = input.value.trim().toLowerCase();
  try {
    await j("/api/channels", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, slug }),
    });
    await loadChannels();
    setNote("");
    toast("Slug saved");
  } catch (err) {
    if (err.message === "auth") return;
    setNote(err.message || "Could not save slug");
  }
}

// ---------- products ----------
function renderPublished(list) {
  lastPublished = list;
  publishedCount = list.filter((p) => p.published).length;
  renderCounts();
  publishedEl.replaceChildren();
  if (!list.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Nothing published yet";
    publishedEl.append(empty);
    return;
  }
  for (const product of list) {
    const row = document.createElement("div");
    row.className = "pub";
    if (product.images?.[0]) {
      const img = thumb(product.images[0]);
      img.className = "pub-img";
      row.append(img);
    } else {
      const blank = document.createElement("span");
      blank.className = "pub-img blank";
      row.append(blank);
    }
    const copy = document.createElement("div");
    copy.className = "pub-copy";
    const title = document.createElement("div");
    title.className = "pub-name";
    title.textContent = displayName(product.name);
    const meta = document.createElement("div");
    meta.className = "muted";
    const tierCount = Array.isArray(product.price_tiers) ? product.price_tiers.length : 0;
    const bits = [product.category, priceLabel(product.price, "MAD", product.price_on_request ? "Price on request" : ""), product.source_channel].filter(Boolean);
    if (tierCount) bits.push(`${tierCount} price tiers`);
    if (!isSubstantialName(product.name)) bits.push("weak name");
    if (!product.published) bits.push("draft");
    meta.textContent = bits.join(" · ");
    copy.append(title, meta);
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "ghost";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => editProduct(product.id));
    const del = document.createElement("button");
    del.type = "button";
    del.className = "danger";
    del.textContent = "Delete";
    del.addEventListener("click", () => removeProduct(product.id, del));
    row.append(copy, edit, del);
    publishedEl.append(row);
  }
}

async function loadPublished() {
  const params = new URLSearchParams({
    supplier_id: $("pub-supplier").value,
    q: $("pub-q").value.trim(),
  });
  renderPublished(await j(`/api/admin/products?${params}`));
}

async function removeProduct(id, button) {
  if (button.dataset.confirm !== "1") {
    button.dataset.confirm = "1";
    button.textContent = "Confirm delete";
    return;
  }
  await j(`/api/products/${id}`, { method: "DELETE" });
  toast("Product deleted");
  await Promise.all([loadPublished(), loadPosts(true)]);
}

function editProduct(id) {
  const product = lastPublished.find((p) => p.id === id);
  if (!product) return;
  resetEditorState();
  setNote("");
  editingId = id;
  pendingSupplierId = product.supplier_id ?? null;
  selImages = [...(product.images || [])];
  emptyEl.hidden = true;
  editor.hidden = false;
  const badge = $("edit-badge");
  badge.hidden = false;
  badge.textContent = `Editing product #${id}${product.published ? "" : " (draft)"}`;
  $("publish").textContent = product.published ? "Save" : "Publish";
  $("post-text").textContent = product.description || "(no description)";
  $("post-phone").hidden = true;
  $("f-name").value = product.name || "";
  $("f-category").value = product.category || "";
  $("f-price").value = product.price || "";
  $("f-por").checked = !!product.price_on_request;
  $("f-stock").value = product.stock || "";
  $("f-moq").value = product.moq || "";
  $("f-desc").value = product.description || "";
  specs = (product.specs || []).map((s) => ({ k: s.k || "", v: s.v || "" }));
  renderSpecs();
  tiers = (product.price_tiers || []).map((tr) => ({ min_qty: tr.min_qty ?? "", max_qty: tr.max_qty ?? "", price: tr.price || "" }));
  renderTiers();
  $("source").textContent = product.source_channel || "";
  formError.hidden = true;
  $("picker").hidden = true;
  renderSelImages();
  renderContact([], product.contact_type ? { type: product.contact_type, value: product.contact || "" } : undefined);
  go("queue");
  editor.scrollIntoView({ behavior: "smooth", block: "start" });
  $("f-name").focus();
}

// ---------- editor images / specs / contact ----------
function renderSelImages() {
  const box = $("sel-images");
  $("img-count").textContent = String(selImages.length);
  box.replaceChildren();
  for (const file of selImages) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sel-img";
    button.title = "Remove image";
    button.append(thumb(file));
    button.addEventListener("click", () => {
      selImages = selImages.filter((item) => item !== file);
      renderSelImages();
      syncPickerSelection();
    });
    box.append(button);
  }
}

function syncPickerSelection() {
  for (const button of $("img-grid").querySelectorAll("button")) {
    button.classList.toggle("sel", selImages.includes(button.dataset.file));
  }
}

async function loadImages(reset) {
  if (reset) imgOffset = 0;
  const params = new URLSearchParams({ q: imgQuery, offset: String(imgOffset), limit: "40" });
  const data = await j(`/api/images?${params}`);
  imgTotal = data.total || 0;
  const grid = $("img-grid");
  if (reset) grid.replaceChildren();
  for (const file of data.items || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.file = file;
    if (selImages.includes(file)) button.classList.add("sel");
    button.append(thumb(file));
    button.addEventListener("click", () => {
      if (selImages.includes(file)) selImages = selImages.filter((item) => item !== file);
      else if (selImages.length < 12) selImages.push(file);
      renderSelImages();
      syncPickerSelection();
    });
    grid.append(button);
  }
  imgOffset = grid.children.length;
  $("img-more").hidden = imgOffset >= imgTotal;
}

function renderContact(phones, preselect) {
  const box = $("contact-options");
  box.replaceChildren();
  const extra = preselect?.value &&
    ![cfg.defaultWhatsapp, phones[0] || "", cfg.defaultChannel, ""].includes(preselect.value)
    ? [{ type: preselect.type, label: `Saved ${preselect.value}`, value: preselect.value, disabled: false }]
    : [];
  const options = [
    {
      type: "whatsapp",
      label: cfg.defaultWhatsapp ? `Default WhatsApp ${cfg.defaultWhatsapp}` : "Default WhatsApp",
      value: cfg.defaultWhatsapp,
      disabled: !cfg.defaultWhatsapp,
    },
    {
      type: "whatsapp-msg",
      label: phones[0] ? `Post WhatsApp ${phones[0]}` : "Post WhatsApp",
      value: phones[0] || "",
      disabled: !phones[0],
    },
    { type: "telegram", label: "Telegram channel", value: cfg.defaultChannel, disabled: !cfg.defaultChannel },
    { type: "none", label: "No contact", value: "", disabled: false },
    ...extra,
  ];
  const picked = preselect && options.find((o) => !o.disabled && o.type === preselect.type && o.value === preselect.value);
  const first = picked || options.find((option) => !option.disabled) || options[3];
  for (const option of options) {
    const label = document.createElement("label");
    label.className = "choice";
    if (option.disabled) label.classList.add("disabled");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "contact";
    input.disabled = option.disabled;
    input.checked = option === first;
    input.addEventListener("change", () => {
      contactType = option.type;
      contactVal = option.value;
    });
    const span = document.createElement("span");
    span.textContent = option.label;
    label.append(input, span);
    box.append(label);
  }
  contactType = first.type;
  contactVal = first.value;
}

function addSpecRow(k, v) {
  specs.push({ k: k || "", v: v || "" });
  renderSpecs();
}

function renderSpecs() {
  const box = $("specs");
  box.replaceChildren();
  specs.forEach((spec, i) => {
    const row = document.createElement("div");
    row.className = "spec-row";
    const key = document.createElement("input");
    key.placeholder = "Attribute (e.g. Color)";
    key.value = spec.k;
    key.addEventListener("input", () => { spec.k = key.value; });
    const value = document.createElement("input");
    value.placeholder = "Value (e.g. Red)";
    value.value = spec.v;
    value.addEventListener("input", () => { spec.v = value.value; });
    const del = document.createElement("button");
    del.type = "button";
    del.className = "danger";
    del.textContent = "✕";
    del.addEventListener("click", () => { specs.splice(i, 1); renderSpecs(); });
    row.append(key, value, del);
    box.append(row);
  });
}

function addTierRow(minQty, maxQty, price) {
  tiers.push({ min_qty: minQty ?? "", max_qty: maxQty ?? "", price: price ?? "" });
  renderTiers();
}

function renderTiers() {
  const box = $("tiers");
  if (!box) return;
  box.replaceChildren();
  tiers.forEach((tier, i) => {
    const row = document.createElement("div");
    row.className = "tier-row";
    const min = document.createElement("input");
    min.type = "number";
    min.min = "1";
    min.placeholder = "From (pcs)";
    min.setAttribute("aria-label", "From quantity");
    min.value = tier.min_qty;
    min.addEventListener("input", () => { tier.min_qty = min.value; });
    const max = document.createElement("input");
    max.type = "number";
    max.min = "1";
    max.placeholder = "To (empty = ∞)";
    max.setAttribute("aria-label", "To quantity, empty means no limit");
    max.value = tier.max_qty ?? "";
    max.addEventListener("input", () => { tier.max_qty = max.value === "" ? null : max.value; });
    const price = document.createElement("input");
    price.placeholder = "Unit price";
    price.setAttribute("aria-label", "Unit price");
    price.value = tier.price;
    price.addEventListener("input", () => { tier.price = price.value; });
    const del = document.createElement("button");
    del.type = "button";
    del.className = "danger";
    del.textContent = "✕";
    del.addEventListener("click", () => { tiers.splice(i, 1); renderTiers(); });
    row.append(min, max, price, del);
    box.append(row);
  });
}

function buildProduct() {
  resetEditorState();
  if (!selected.size) {
    setNote("Select at least one post");
    return;
  }
  setNote("");
  const posts = [...selected.values()].sort((a, b) => a.msg_id - b.msg_id);
  selImages = posts.map((post) => post.image).filter(Boolean);
  const text = posts.map((post) => post.text).filter(Boolean).join("\n\n──────────\n\n");
  const phones = [...new Set(posts.flatMap((post) => post.phone || []))];
  emptyEl.hidden = true;
  editor.hidden = false;
  $("post-text").textContent = text || "(no text)";
  $("post-phone").hidden = phones.length === 0;
  $("post-phone").textContent = phones.length ? `Numbers in posts: ${phones.join(", ")}` : "";
  $("f-name").value = suggestedName(text);
  $("f-price").value = "";
  $("f-por").checked = false;
  $("f-stock").value = "";
  $("f-moq").value = "";
  $("f-desc").value = "";
  specs = [];
  renderSpecs();
  tiers = [];
  renderTiers();
  $("source").textContent = posts[0]?.channel || "";
  formError.hidden = true;
  $("picker").hidden = true;
  renderSelImages();
  renderContact(phones);
  $("f-name").focus();
}

async function publish(event, asDraft = false) {
  if (event) event.preventDefault();
  if (saving) return;
  const name = $("f-name").value.trim();
  if (!isSubstantialName(name)) {
    formError.hidden = false;
    formError.textContent = "Product name is required";
    return;
  }
  saving = true;
  $("publish").disabled = true;
  $("save-draft").disabled = true;
  try {
    const queueSupplier = supplierEl.value && supplierEl.value !== "unlinked" ? Number(supplierEl.value) : null;
    const payload = {
      name,
      category: $("f-category").value,
      price: $("f-price").value,
      price_on_request: $("f-por").checked,
      stock: $("f-stock").value,
      moq: $("f-moq").value,
      description: $("f-desc").value,
      images: selImages,
      contact: contactVal,
      contact_type: contactType,
      source_channel: $("source").textContent,
      post_ids: [...selected.keys()],
      specs: specs.filter((spec) => spec.k.trim() && spec.v.trim()),
      price_tiers: tiers,
      published: asDraft ? 0 : 1,
    };
    if (pendingSupplierId) payload.supplier_id = pendingSupplierId;
    else if (queueSupplier) payload.supplier_id = queueSupplier;
    if (pendingSubmissionIds.length) payload.submission_ids = pendingSubmissionIds;
    if (editingId) {
      await j(`/api/products/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      toast("Product saved");
    } else {
      await j("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      toast(asDraft ? "Draft saved" : "Product published");
    }
    resetEditorState();
    editor.hidden = true;
    emptyEl.hidden = false;
    await refreshAll();
  } catch (err) {
    if (err.message === "auth") return;
    formError.hidden = false;
    formError.textContent = err.message || "Could not publish";
  } finally {
    saving = false;
    $("publish").disabled = false;
    $("save-draft").disabled = false;
  }
}

async function skip() {
  const ids = [...selected.values()].filter((post) => post.status !== "done").map((post) => post.id);
  if (!ids.length) {
    setNote("Published posts only return when you delete the product");
    return;
  }
  await j("/api/posts/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, status: "skipped" }),
  });
  for (const id of ids) selected.delete(id);
  setNote("");
  toast("Skipped");
  await loadPosts(true);
}

// ---------- suppliers ----------
function supplierById(id) {
  return suppliers.find((s) => s.id === id);
}

function suggestSlug(name) {
  return String(name || "").toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, "").replace(/[\s_]+/g, "-").replace(/-+/g, "-")
    .replace(/^-|-$/g, "").slice(0, 60);
}

async function loadSuppliers() {
  suppliers = await j("/api/suppliers");
  renderSuppliers();
  const curQ = supplierEl.value;
  supplierEl.replaceChildren(
    new Option("Select supplier", ""),
    ...suppliers.map((s) => new Option(`${s.name || `#${s.id}`} · ${s.status}`, String(s.id))),
    new Option("Unlinked (legacy)", "unlinked"),
  );
  if ([...supplierEl.options].some((o) => o.value === curQ)) supplierEl.value = curQ;
  const subSel = $("sub-supplier");
  const subCur = subSel.value;
  subSel.replaceChildren(
    new Option("All suppliers", ""),
    ...suppliers.map((s) => new Option(s.name || `#${s.id}`, String(s.id))),
  );
  if ([...subSel.options].some((o) => o.value === subCur)) subSel.value = subCur;
  const m = $("m-supplier");
  m.replaceChildren(...suppliers.map((s) => new Option(s.name || `#${s.id}`, String(s.id))));
  const pub = $("pub-supplier");
  const pubCur = pub.value;
  pub.replaceChildren(
    new Option("All suppliers", ""),
    ...suppliers.map((s) => new Option(s.name || `#${s.id}`, String(s.id))),
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
    td.textContent = "No suppliers yet — they appear after /start on Telegram.";
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
    const strong = document.createElement("div");
    strong.innerHTML = `<strong>${esc(s.name || `#${s.id}`)}</strong>`;
    const sub = document.createElement("div");
    sub.className = "muted";
    sub.textContent = `${supplierStatusBadge(s.status).replace(/<[^>]+>/g, "")} · ${s.whatsapp || "no number"}`;
    name.append(strong, sub);
    const chan = document.createElement("td");
    chan.innerHTML = `<div>${esc(s.channel_title || "—")}</div><div class="muted mono">${esc(s.channel_id || "")}</div>`;
    const store = document.createElement("td");
    store.innerHTML = s.channel_slug ? `<a class="text-link mono" href="/c/${encodeURIComponent(s.channel_slug)}" target="_blank" rel="noopener">/c/${esc(s.channel_slug)}</a>` : '<span class="muted">—</span>';
    const plan = document.createElement("td");
    plan.innerHTML = `${phaseBadge(s.phase)}<div class="muted">${esc(s.plan_name || "")}</div>`;
    const due = document.createElement("td");
    due.innerHTML = `<div class="mono">${esc(dueText(s))}</div>`;
    const prods = document.createElement("td");
    prods.textContent = s.product_count ?? 0;
    const paid = document.createElement("td");
    paid.textContent = fmtMAD(s.total_paid_minor ?? 0);
    tr.append(name, chan, store, plan, due, prods, paid);
    body.append(tr);
  }
}

async function openSupplier(id) {
  const detail = await j(`/api/suppliers/${id}/detail`).catch((e) => {
    if (e.message !== "auth") toast(e.message, true);
    return null;
  });
  if (!detail) return;
  const { supplier: s, subscription: sub, payments, timeline, summary } = detail;
  openDrawer(`#${s.id} ${s.name || ""}`, supplierStatusBadge(s.status));
  const wa = s.whatsapp ? `<a class="mono" target="_blank" href="https://wa.me/${s.whatsapp.replace(/[^0-9]/g, "")}">${esc(s.whatsapp)}</a>` : "—";
  const tg = s.telegram_id ? `<a class="mono" href="tg://user?id=${s.telegram_id}">${esc(String(s.telegram_id))}</a>` : "—";
  $("drawer-body").innerHTML = `
    <div class="panel">
      <h3>Profile</h3>
      <div class="fields">
        <label class="stack">Name<input id="d-name" value="${esc(s.name || "")}"></label>
        <label class="stack">Username<input id="d-user" value="${esc(s.username || "")}" dir="ltr"></label>
        <label class="stack">WhatsApp<input id="d-wa" value="${esc(s.whatsapp || "")}" dir="ltr"></label>
        <label class="stack">Telegram ID<input id="d-tg" value="${esc(s.telegram_id ?? "")}" dir="ltr"></label>
      </div>
      <div class="muted" style="margin-top:8px">Telegram ${tg} · WhatsApp ${wa} · since ${fmtDate(s.created_at)}</div>
      <div class="editor-actions" style="margin-top:10px">
        <button class="primary" id="d-save-profile" type="button">Save profile</button>
      </div>
    </div>
    <div class="panel">
      <h3>Channel &amp; store</h3>
      <div class="muted">Channel (linked by the supplier via bot admin)</div>
      <div style="font-weight:600">${esc(s.channel_title || "— not linked —")}</div>
      <div class="muted mono">${esc(s.channel_id || "")}</div>
      <div class="fields" style="margin-top:10px">
        <label class="stack">Store slug<input id="d-slug" value="${esc(s.channel_slug || "")}" dir="ltr" placeholder="e.g. said-shop"></label>
        <label class="stack">Status
          <select id="d-status">
            <option value="pending">Pending</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
        </label>
      </div>
      <div class="editor-actions" style="margin-top:10px">
        <button class="ghost" id="d-suggest" type="button">Use channel name</button>
        <button class="primary" id="d-save-store" type="button">Save store</button>
      </div>
      ${s.channel_slug ? `<div style="margin-top:8px"><a class="text-link mono" target="_blank" href="/c/${encodeURIComponent(s.channel_slug)}">/c/${esc(s.channel_slug)} ↗</a></div>` : ""}
    </div>
    <div class="panel">
      <h3>Subscription ${sub ? phaseBadge(sub.phase) : ""}</h3>
      ${sub ? `<div class="muted">${esc(sub.plan_name || "")} · ${fmtMAD(sub.amount_minor)}/${esc(sub.billing_cycle || "")} · ${dueText({ ...sub })}</div>` : '<div class="muted">No subscription yet.</div>'}
      <div class="editor-actions" style="margin-top:10px">
        <button class="ghost" id="d-plan" type="button">Set plan</button>
        <button class="ghost" id="d-trial" type="button">Start 14-day trial</button>
        <button class="ghost" id="d-pay" type="button">Record payment</button>
      </div>
    </div>
    <div class="panel">
      <h3>Catalog build (onboarding)</h3>
      <div class="muted">Pay-first flow: record his estimate now, reconcile the exact count after the build.</div>
      <div class="fields" style="margin-top:10px">
        <label class="stack">Rate (MAD / product)<input id="d-rate" type="number" min="0" value="2"></label>
        <label class="stack">Published products<input value="${summary.published_products}" disabled></label>
      </div>
      <div id="d-build-math" class="muted" style="margin-top:8px"></div>
      <div class="editor-actions" style="margin-top:10px">
        <button class="ghost" id="d-estimate" type="button">Record estimate upfront</button>
        <button class="primary" id="d-balance" type="button">Record balance</button>
      </div>
    </div>
    <div class="panel">
      <h3>Analytics (last 30 days)</h3>
      <div id="d-analytics"><div class="muted">Loading…</div></div>
    </div>
    <div class="panel">
      <h3>Payments (${payments.length}) · total ${fmtMAD(summary.total_paid_minor)}</h3>
      <div>${payments.map((p) => `<div class="due-row"><strong>${fmtMAD(p.amount_minor)}</strong><span class="badge ${p.kind === "onboarding" ? "b-blue" : "b-green"}">${p.kind === "onboarding" ? "build" : "sub"}</span><span class="badge b-gray">${esc(p.method || "")}</span><span class="grow" style="flex:1"></span><span class="muted mono">${fmtDate(p.paid_at)}</span></div>`).join("") || '<div class="muted">No payments.</div>'}</div>
    </div>
    <div class="panel">
      <h3>Products · ${summary.products} (${summary.published_products} published)</h3>
      <div class="editor-actions">
        <button class="ghost" id="d-products" type="button">View products</button>
        <button class="ghost" id="d-queue" type="button">Open queue</button>
      </div>
    </div>
    <div class="panel">
      <h3>Notes &amp; timeline</h3>
      <div class="fields">
        <label class="stack span-2">Add note<textarea id="d-note" rows="2"></textarea></label>
      </div>
      <div class="editor-actions" style="margin-top:8px">
        <button class="ghost" id="d-note-save" type="button">Save note</button>
        <button class="ghost" id="d-revoke" type="button">Revoke supplier sessions</button>
      </div>
      <div style="margin-top:10px">${timeline.map((e) => `<div class="due-row"><span class="badge b-gray">${esc(e.event_type)}</span><span class="muted">${esc(e.actor || "")}</span><span class="grow" style="flex:1"></span><span class="muted mono">${fmtDate(e.created_at)}</span></div>`).join("") || '<div class="muted">No events.</div>'}</div>
    </div>`;
  $("d-status").value = s.status;
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
  $("d-save-store").addEventListener("click", async () => {
    try {
      await j(`/api/suppliers/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_slug: $("d-slug").value.trim().toLowerCase(), status: $("d-status").value }),
      });
      toast("Store saved");
      await refreshAll();
      openSupplier(id);
    } catch (e) { if (e.message !== "auth") toast(e.message, true); }
  });
  $("d-plan").addEventListener("click", () => openSubscriptionModal(id, sub));
  $("d-trial").addEventListener("click", () => startTrial(id));
  $("d-pay").addEventListener("click", () => openPaymentModal(id));
  $("d-products").addEventListener("click", () => {
    closeDrawer();
    go("products");
    $("pub-supplier").value = String(id);
    loadPublished().catch((e) => toast(e.message, true));
  });
  $("d-queue").addEventListener("click", () => {
    closeDrawer();
    go("queue");
    supplierEl.value = String(id);
    loadPosts(true).catch((e) => toast(e.message, true));
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

// ---------- submissions ----------
async function loadSubs(reset) {
  if (reset) {
    subsOffset = 0;
    subs = [];
  }
  const params = new URLSearchParams({
    status: $("sub-status").value,
    supplier_id: $("sub-supplier").value,
    offset: String(subsOffset),
    limit: "30",
  });
  const data = await j(`/api/submissions?${params}`);
  subs = reset ? data.items || [] : subs.concat(data.items || []);
  subsOffset = subs.length;
  subsTotal = data.total || 0;
  renderSubs();
}

function renderSubs() {
  const box = $("subs");
  box.replaceChildren();
  const badge = $("subs-badge");
  const fresh = suppliers.reduce((n, s) => n + (s.new_submissions || 0), 0);
  badge.hidden = !fresh;
  badge.textContent = fresh ? String(fresh) : "";
  if (!subs.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Nothing here";
    box.append(p);
  }
  for (const sub of subs) {
    const row = document.createElement("div");
    row.className = "sub-row";
    const subImages = parseImages(sub);
    if (subImages[0]) {
      const img = thumb(subImages[0]);
      img.className = "q-img";
      row.append(img);
    }
    const copy = document.createElement("div");
    copy.className = "sub-copy";
    const meta = document.createElement("span");
    meta.className = "q-meta";
    const supp = supplierById(sub.supplier_id);
    meta.textContent = [supp?.name || `#${sub.supplier_id}`, subImages.length > 1 ? `${subImages.length} photos` : "", sub.status, sub.id ? `#${sub.id}` : ""].filter(Boolean).join(" · ");
    const txt = document.createElement("div");
    txt.className = "sub-text";
    txt.textContent = (sub.text || "").slice(0, 300) || "(no text)";
    copy.append(meta, txt);
    const actions = document.createElement("div");
    actions.className = "sub-actions";
    const add = document.createElement("button");
    add.type = "button";
    add.className = "primary";
    add.textContent = "Add to catalog";
    add.addEventListener("click", () => buildFromSubmission(sub));
    const skipBtn = document.createElement("button");
    skipBtn.type = "button";
    skipBtn.className = "ghost";
    skipBtn.textContent = "Skip";
    skipBtn.addEventListener("click", async () => {
      await j("/api/submissions/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [sub.id], status: "skipped" }),
      });
      toast("Skipped");
      await loadSubs(true);
      await loadSuppliers();
    });
    actions.append(add, skipBtn);
    row.append(copy, actions);
    box.append(row);
  }
  $("subs-more").hidden = subs.length >= subsTotal;
}

// Every image attached to a submission: the images[] array (albums) with a
// fallback to the legacy single image column.
function parseImages(sub) {
  try {
    const arr = typeof sub.images === "string" ? JSON.parse(sub.images) : sub.images;
    if (Array.isArray(arr) && arr.length) return arr.filter((f) => typeof f === "string" && f);
  } catch {
    /* fall through to single image */
  }
  return sub.image ? [sub.image] : [];
}

function buildFromSubmission(sub) {
  const supp = supplierById(sub.supplier_id);
  resetEditorState();
  pendingSubmissionIds = [sub.id];
  pendingSupplierId = sub.supplier_id;
  setNote("");
  // All album photos travel together — never just the first one.
  selImages = parseImages(sub);
  const phones = supp?.whatsapp ? [supp.whatsapp] : [];
  emptyEl.hidden = true;
  editor.hidden = false;
  $("post-text").textContent = sub.text || "(no text)";
  $("post-phone").hidden = phones.length === 0;
  $("post-phone").textContent = phones.length ? `Supplier WhatsApp: ${phones.join(", ")}` : "";
  $("f-name").value = suggestedName(sub.text || "");
  $("f-price").value = "";
  $("f-por").checked = false;
  $("f-stock").value = "";
  $("f-moq").value = "";
  $("f-desc").value = "";
  specs = [];
  renderSpecs();
  tiers = [];
  renderTiers();
  $("source").textContent = supp?.channel_title || supp?.name || "";
  formError.hidden = true;
  $("picker").hidden = true;
  renderSelImages();
  renderContact(phones);
  go("queue");
  editor.scrollIntoView({ behavior: "smooth", block: "start" });
  $("f-name").focus();
}

// ---------- overview + payments pages ----------
async function loadStats() {
  statsCache = await j("/api/admin/stats");
  renderStats();
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
    nm.addEventListener("click", () => openSupplier(a.id));
    const badge = document.createElement("span");
    badge.innerHTML = phaseBadge(a.phase);
    const when = document.createElement("span");
    when.className = "muted mono";
    when.textContent = a.phase.startsWith("trial") ? `trial ends ${fmtDate(a.trial_ends_at)}` : `due ${fmtDate(a.next_due_at)}`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ghost";
    btn.textContent = "+30d";
    btn.addEventListener("click", () => extendSub(a.id, 30));
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
    tr.innerHTML = `<td class="mono">#${p.id}</td><td>${esc(p.supplier_name || `#${p.supplier_id}`)}</td>
      <td><strong>${fmtMAD(p.amount_minor)}</strong></td><td>${esc(p.method || "")}</td>
      <td class="muted mono">${esc(period)}</td><td class="muted mono">${fmtDate(p.paid_at)}</td>`;
    tr.addEventListener("click", () => openSupplier(p.supplier_id));
    body.append(tr);
  }
}

// ---------- events ----------
for (const btn of document.querySelectorAll("[data-page]")) {
  btn.addEventListener("click", () => go(btn.dataset.page));
}
for (const btn of document.querySelectorAll("[data-go]")) {
  btn.addEventListener("click", () => go(btn.dataset.go));
}
$("drawer-close").addEventListener("click", closeDrawer);
$("drawer-backdrop").addEventListener("click", closeDrawer);
$("modal-backdrop").addEventListener("click", closeModal);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("modal-wrap").hidden) closeModal();
});
$("refresh").addEventListener("click", () => refreshAll().catch((e) => toast(e.message, true)));
$("supp-add").addEventListener("click", openSupplierModal);
$("pay-add").addEventListener("click", () => openPaymentModal());
$("logout").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  location.href = "/login";
});

document.addEventListener("mouseover", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLImageElement) || target.id === "preview" || !target.dataset.full) return;
  preview.src = target.dataset.full;
  preview.hidden = false;
  const width = 300, height = 300;
  let x = event.clientX + 16, y = event.clientY + 16;
  if (x + width > window.innerWidth) x = event.clientX - width - 16;
  if (y + height > window.innerHeight) y = Math.max(8, event.clientY - height - 16);
  preview.style.left = `${x}px`;
  preview.style.top = `${y}px`;
});
document.addEventListener("mousemove", (event) => {
  if (preview.hidden) return;
  const width = 300, height = 300;
  let x = event.clientX + 16, y = event.clientY + 16;
  if (x + width > window.innerWidth) x = event.clientX - width - 16;
  if (y + height > window.innerHeight) y = Math.max(8, event.clientY - height - 16);
  preview.style.left = `${x}px`;
  preview.style.top = `${y}px`;
});
document.addEventListener("mouseout", (event) => {
  if (event.target instanceof HTMLImageElement && event.target.id !== "preview") preview.hidden = true;
});

$("clear").addEventListener("click", () => {
  selected.clear();
  renderSelection();
  renderQueue();
});
$("skip").addEventListener("click", () => skip().catch((err) => setNote(err.message)));
$("build").addEventListener("click", buildProduct);
$("cancel").addEventListener("click", () => {
  resetEditorState();
  renderSelection();
  renderQueue();
  editor.hidden = true;
  emptyEl.hidden = false;
});
editor.addEventListener("submit", (event) => publish(event, false).catch((err) => setNote(err.message)));
$("save-draft").addEventListener("click", () => publish(null, true).catch((err) => setNote(err.message)));
$("btn-add-img").addEventListener("click", () => {
  const picker = $("picker");
  picker.hidden = !picker.hidden;
  if (!picker.hidden) {
    imgQuery = "";
    $("img-q").value = "";
    loadImages(true).catch((err) => setNote(err.message));
  }
});
$("btn-add-spec").addEventListener("click", () => addSpecRow("", ""));
$("btn-add-tier").addEventListener("click", () => addTierRow("", null, ""));
$("img-q").addEventListener("input", () => {
  imgQuery = $("img-q").value.trim();
  clearTimeout(imgTimer);
  imgTimer = setTimeout(() => loadImages(true).catch((err) => setNote(err.message)), 200);
});
$("img-more").addEventListener("click", () => loadImages(false).catch((err) => setNote(err.message)));
$("more").addEventListener("click", () => loadPosts(false).catch((err) => setNote(err.message)));
queryEl.addEventListener("input", () => {
  clearTimeout(queryTimer);
  queryTimer = setTimeout(() => loadPosts(true).catch((err) => setNote(err.message)), 200);
});
statusEl.addEventListener("change", () => loadPosts(true).catch((err) => setNote(err.message)));
channelEl.addEventListener("change", () => loadPosts(true).catch((err) => setNote(err.message)));
supplierEl.addEventListener("change", () => {
  selected.clear();
  loadPosts(true).catch((err) => setNote(err.message));
});
$("subs-refresh").addEventListener("click", () => loadSubs(true).catch((e) => toast(e.message, true)));
$("sub-status").addEventListener("change", () => loadSubs(true).catch((e) => toast(e.message, true)));
$("sub-supplier").addEventListener("change", () => loadSubs(true).catch((e) => toast(e.message, true)));
$("subs-more").addEventListener("click", () => loadSubs(false).catch((e) => toast(e.message, true)));
$("pub-supplier").addEventListener("change", () => loadPublished().catch((e) => toast(e.message, true)));
$("pub-q").addEventListener("input", () => {
  clearTimeout(queryTimer);
  queryTimer = setTimeout(() => loadPublished().catch((e) => toast(e.message, true)), 250);
});
$("m-add").addEventListener("click", async () => {
  const err = $("m-error");
  err.hidden = true;
  try {
    await j("/api/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplier_id: Number($("m-supplier").value),
        text: $("m-text").value,
        image: $("m-image").value.trim(),
      }),
    });
    $("m-text").value = "";
    $("m-image").value = "";
    toast("Submission added");
    await loadSubs(true);
    await loadSuppliers();
  } catch (e) {
    if (e.message === "auth") return;
    err.hidden = false;
    err.textContent = e.message || "Could not add";
  }
});

async function fillCategories() {
  const categories = await j("/api/categories");
  const select = $("f-category");
  select.replaceChildren(new Option("— Select —", ""));
  for (const name of categories) select.append(new Option(name, name));
}

async function refreshAll() {
  await loadSuppliers();
  await Promise.all([loadStats(), loadPayments(), loadChannels(), loadPublished(), loadPosts(true), loadSubs(true)]);
}

try {
  cfg = await j("/api/config");
  await fillCategories();
  await refreshAll();
  go("overview");
} catch (err) {
  if (err.message !== "auth") setNote(err.message || "Could not load");
}
