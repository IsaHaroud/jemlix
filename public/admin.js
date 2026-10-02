import { displayName, isSubstantialName, mediaUrl, priceLabel, suggestedName, thumbUrl } from "./format.js";

const $ = (id) => document.getElementById(id);
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
let imgOffset = 0;
let imgTotal = 0;
let imgQuery = "";
let imgTimer = 0;
let queryTimer = 0;
let saving = false;

async function j(url, opts) {
  const res = await fetch(url, opts);
  if (res.status === 401) {
    location.href = "/login";
    throw new Error("auth");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "خطأ");
  return data;
}

function setNote(text) {
  noteEl.hidden = !text;
  noteEl.textContent = text || "";
}

function renderCounts() {
  countsEl.textContent = `جديد ${counts.new} · منشور ${publishedCount}`;
}

function renderSelection() {
  selCount.textContent = `${selected.size} محدد`;
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
    line.textContent = raw ? raw.slice(0, 90) : "(بلا نص)";
    const meta = document.createElement("span");
    meta.className = "q-meta";
    const state = post.status === "done" ? "منشور" : post.status === "skipped" ? "متخطى" : "";
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
  moreEl.textContent = `عرض المزيد (${Math.max(total - loaded.length, 0)} باقي)`;
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
    setNote("اختار المورّد باش تشوف البوسطات ديالو");
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
  channelEl.replaceChildren(new Option("كل القنوات", ""));
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
    input.setAttribute("aria-label", `سيلغ ${ch.name}`);
    const save = document.createElement("button");
    save.type = "button";
    save.className = "ghost";
    save.textContent = "حفظ";
    save.addEventListener("click", () => saveSlug(ch.name, input));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveSlug(ch.name, input);
      }
    });
    const count = document.createElement("span");
    count.className = "muted";
    count.textContent = `${ch.count} منتج`;
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
  } catch (err) {
    if (err.message === "auth") return;
    setNote(err.message || "تعذر حفظ السيلغ");
  }
}

function renderPublished(list) {
  lastPublished = list;
  publishedCount = list.filter((p) => p.published).length;
  renderCounts();
  publishedEl.replaceChildren();
  if (!list.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "مازال ما نشرتي والو";
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
    const bits = [product.category, priceLabel(product.price, "د.م", product.price_on_request ? "الثمن عند الطلب" : ""), product.source_channel].filter(Boolean);
    if (!isSubstantialName(product.name)) bits.push("الاسم غير كافٍ");
    if (!product.published) bits.push("مسودة");
    meta.textContent = bits.join(" · ");
    copy.append(title, meta);
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "ghost";
    edit.textContent = "تعديل";
    edit.addEventListener("click", () => editProduct(product.id));
    const del = document.createElement("button");
    del.type = "button";
    del.className = "danger";
    del.textContent = "حذف";
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
  const list = await j(`/api/admin/products?${params}`);
  renderPublished(list);
}

async function removeProduct(id, button) {
  if (button.dataset.confirm !== "1") {
    button.dataset.confirm = "1";
    button.textContent = "تأكيد الحذف";
    return;
  }
  await j(`/api/products/${id}`, { method: "DELETE" });
  await Promise.all([loadPublished(), loadPosts(true)]);
}

function renderSelImages() {
  const box = $("sel-images");
  $("img-count").textContent = String(selImages.length);
  box.replaceChildren();
  for (const file of selImages) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sel-img";
    button.title = "حيد الصورة";
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
    !["", cfg.defaultWhatsapp, phones[0] || "", cfg.defaultChannel].includes(preselect.value)
    ? [{ type: preselect.type, label: `المحفوظ ${preselect.value}`, value: preselect.value, disabled: false }]
    : [];
  const options = [
    {
      type: "whatsapp",
      label: cfg.defaultWhatsapp ? `واتساب الافتراضي ${cfg.defaultWhatsapp}` : "واتساب الافتراضي",
      value: cfg.defaultWhatsapp,
      disabled: !cfg.defaultWhatsapp,
    },
    {
      type: "whatsapp-msg",
      label: phones[0] ? `واتساب فالبوسط ${phones[0]}` : "واتساب فالبوسط",
      value: phones[0] || "",
      disabled: !phones[0],
    },
    { type: "telegram", label: "قناة تيليغرام", value: cfg.defaultChannel, disabled: !cfg.defaultChannel },
    { type: "none", label: "بلا تواصل", value: "", disabled: false },
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
    key.placeholder = "الصفة (مثلا: اللون)";
    key.value = spec.k;
    key.addEventListener("input", () => { spec.k = key.value; });
    const value = document.createElement("input");
    value.placeholder = "القيمة (مثلا: أحمر)";
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

function buildProduct() {
  resetEditorState();
  if (!selected.size) {
    setNote("اختار بوسط واحد على الأقل");
    return;
  }
  setNote("");
  const posts = [...selected.values()].sort((a, b) => a.msg_id - b.msg_id);
  selImages = posts.map((post) => post.image).filter(Boolean);
  const text = posts.map((post) => post.text).filter(Boolean).join("\n\n──────────\n\n");
  const phones = [...new Set(posts.flatMap((post) => post.phone || []))];
  emptyEl.hidden = true;
  editor.hidden = false;
  $("post-text").textContent = text || "(بلا نص)";
  $("post-phone").hidden = phones.length === 0;
  $("post-phone").textContent = phones.length ? `أرقام فالبوسطات: ${phones.join("، ")}` : "";
  $("f-name").value = suggestedName(text);
  $("f-price").value = "";
  $("f-por").checked = false;
  $("f-stock").value = "";
  $("f-moq").value = "";
  $("f-desc").value = "";
  specs = [];
  renderSpecs();
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
    formError.textContent = "اسم المنتج غير كافٍ";
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
    } else {
      await j("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
    resetEditorState();
    editor.hidden = true;
    emptyEl.hidden = false;
    await Promise.all([loadPosts(true), loadPublished(), loadSubs(true), loadSuppliers()]);
  } catch (err) {
    if (err.message === "auth") return;
    formError.hidden = false;
    formError.textContent = err.message || "تعذر النشر";
  } finally {
    saving = false;
    $("publish").disabled = false;
    $("save-draft").disabled = false;
  }
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
  badge.textContent = `تعديل المنتج #${id}${product.published ? "" : " (مسودة)"}`;
  $("publish").textContent = product.published ? "حفظ" : "نشر";
  $("post-text").textContent = product.description || "(بلا وصف)";
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
  $("source").textContent = product.source_channel || "";
  formError.hidden = true;
  $("picker").hidden = true;
  renderSelImages();
  renderContact([], product.contact_type ? { type: product.contact_type, value: product.contact || "" } : undefined);
  switchTab("posts");
  requestAnimationFrame(() => {
    editor.scrollIntoView({ behavior: "smooth", block: "start" });
    $("f-name").focus({ preventScroll: true });
  });
}

async function skip() {
  const ids = [...selected.values()].filter((post) => post.status !== "done").map((post) => post.id);
  if (!ids.length) {
    setNote("البوسط المنشور كيرجع غير إلا حذفتي المنتج");
    return;
  }
  await j("/api/posts/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, status: "skipped" }),
  });
  for (const id of ids) selected.delete(id);
  setNote("");
  await loadPosts(true);
}

function placePreview(event) {
  const width = 320;
  const height = 320;
  let x = event.clientX + 16;
  let y = event.clientY + 16;
  if (x + width > window.innerWidth) x = event.clientX - width - 16;
  if (y + height > window.innerHeight) y = Math.max(8, event.clientY - height - 16);
  preview.style.left = `${x}px`;
  preview.style.top = `${y}px`;
}

document.addEventListener("mouseover", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLImageElement) || target.id === "preview" || !target.dataset.full) return;
  preview.src = target.dataset.full;
  preview.hidden = false;
  placePreview(event);
});
document.addEventListener("mousemove", (event) => {
  if (!preview.hidden) placePreview(event);
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
supplierEl.addEventListener("change", () => {
  selected.clear();
  loadPosts(true).catch((err) => setNote(err.message));
});
channelEl.addEventListener("change", () => loadPosts(true).catch((err) => setNote(err.message)));
$("logout").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  location.href = "/login";
});

async function fillCategories() {
  const categories = await j("/api/categories");
  const select = $("f-category");
  select.replaceChildren(new Option("— اختر —", ""));
  for (const name of categories) select.append(new Option(name, name));
}

// ---------- WORKFLOW.md Phase 1: suppliers + submissions ----------
let suppliers = [];
let subs = [];
let subsOffset = 0;
let subsTotal = 0;
let pendingSubmissionIds = [];
let pendingSupplierId = null;
let editingId = null;
let lastPublished = [];
let selectedSupplierId = null;
let selectedSupplierDetail = null;

const billingLabels = {
  unconfigured: "بلا اشتراك",
  trial: "تجريبي",
  trial_ending: "التجربة غتسالي",
  trial_ended: "التجربة سالات",
  active: "نشط",
  due_soon: "الأداء قريب",
  due_today: "الأداء اليوم",
  grace: "فمدة السماح",
  overdue: "متأخر",
  paused: "موقوف",
  churned: "غادر",
};

function formatMoney(minor, currency = "MAD") {
  return new Intl.NumberFormat("ar-MA", { style: "currency", currency, minimumFractionDigits: 2 }).format(Number(minor || 0) / 100);
}

function readableDate(value) {
  if (!value) return "—";
  const source = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value.replace(" ", "T");
  const date = new Date(source);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ar-MA", { dateStyle: "medium" }).format(date);
}

function isoToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function cycleEnd(start, cycle) {
  if (!start || cycle === "custom") return "";
  const date = new Date(`${start}T12:00:00`);
  if (cycle === "monthly") date.setMonth(date.getMonth() + 1);
  if (cycle === "quarterly") date.setMonth(date.getMonth() + 3);
  if (cycle === "yearly") date.setFullYear(date.getFullYear() + 1);
  return date.toISOString().slice(0, 10);
}

function dirhamToMinor(value) {
  const normalized = String(value || "").trim().replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.round(number * 100) : NaN;
}

function makeStat(label, value, tone = "") {
  const card = document.createElement("div");
  card.className = `billing-card ${tone}`.trim();
  const strong = document.createElement("strong");
  strong.textContent = value;
  const span = document.createElement("span");
  span.textContent = label;
  card.append(strong, span);
  return card;
}

function resetEditorState() {
  selected.clear();
  pendingSubmissionIds = [];
  pendingSupplierId = null;
  editingId = null;
  $("edit-badge").hidden = true;
  $("publish").textContent = "نشر";
}

function switchTab(name) {
  for (const [btn, view, key] of [["tab-posts", "view-posts", "posts"], ["tab-products", "view-products", "products"], ["tab-subs", "view-subs", "subs"], ["tab-supp", "view-supp", "supp"]]) {
    $(view).hidden = key !== name;
    $(btn).setAttribute("aria-selected", key === name ? "true" : "false");
  }
  document.body.classList.toggle("admin-wide", name !== "posts");
}

function supplierById(id) {
  return suppliers.find((s) => s.id === id);
}

async function loadSuppliers() {
  suppliers = await j("/api/suppliers");
  renderSuppliers();
  const curQ = supplierEl.value;
  supplierEl.replaceChildren(new Option("اختار المورّد", ""), ...suppliers.map((s) => new Option(`${s.name || `#${s.id}`} · ${s.status}`, String(s.id))), new Option("بلا مورّد (قديم)", "unlinked"));
  if ([...supplierEl.options].some((o) => o.value === curQ)) supplierEl.value = curQ;
  const opts = [new Option("كل المورّدين", ""), ...suppliers.map((s) => new Option(`${s.name || `#${s.id}`} · ${s.status}`, String(s.id)))];
  const sel = $("sub-supplier");
  const cur = sel.value;
  sel.replaceChildren(...opts);
  if ([...opts].some((o) => o.value === cur)) sel.value = cur;
  const m = $("m-supplier");
  m.replaceChildren(...suppliers.map((s) => new Option(s.name || `#${s.id}`, String(s.id))));
  const pub = $("pub-supplier");
  const pubCur = pub.value;
  pub.replaceChildren(new Option("كل المورّدين", ""), ...suppliers.map((s) => new Option(s.name || `#${s.id}`, String(s.id))), new Option("بلا مورّد (قديم)", "unlinked"));
  if ([...pub.options].some((o) => o.value === pubCur)) pub.value = pubCur;
}

function renderSuppliers() {
  const box = $("suppliers");
  box.replaceChildren();
  const overview = $("billing-overview");
  const attention = suppliers.filter((s) => ["overdue", "grace", "due_today", "trial_ended"].includes(s.phase)).length;
  const soon = suppliers.filter((s) => ["due_soon", "trial_ending"].includes(s.phase)).length;
  const active = suppliers.filter((s) => ["active", "trial"].includes(s.phase)).length;
  overview.replaceChildren(
    makeStat("الموردون", String(suppliers.length)),
    makeStat("خاص المتابعة", String(attention), attention ? "danger" : ""),
    makeStat("قريب يخلص", String(soon), soon ? "warn" : ""),
    makeStat("مزيان دابا", String(active), "good"),
  );
  const needle = $("supp-q").value.trim().toLowerCase();
  const filter = $("supp-billing-filter").value;
  const shown = suppliers.filter((s) => {
    const matchesText = !needle || `${s.name || ""} ${s.whatsapp || ""} ${s.channel_slug || ""} ${s.username || ""}`.toLowerCase().includes(needle);
    const matchesFilter = !filter
      || (filter === "attention" && ["overdue", "grace", "due_today", "trial_ended"].includes(s.phase))
      || (filter === "trial" && ["trial", "trial_ending", "trial_ended"].includes(s.phase))
      || s.phase === filter;
    return matchesText && matchesFilter;
  });
  if (!shown.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = suppliers.length ? "ما لقينا حتى مورّد بهاد الفلتر" : "مازال ما كاين حتى مورّد — زيد الأول الفوق";
    box.append(p);
    return;
  }
  for (const s of shown) {
    const row = document.createElement("div");
    row.className = "crm-supplier";
    const main = document.createElement("button");
    main.type = "button";
    main.className = "crm-supplier-main";
    main.addEventListener("click", () => openSupplierDetail(s.id).catch((err) => setNote(err.message)));
    const title = document.createElement("span");
    title.className = "supp-name";
    title.textContent = s.name || `#${s.id}`;
    const badge = document.createElement("span");
    badge.className = `billing-badge phase-${s.phase}`;
    badge.textContent = billingLabels[s.phase] || s.phase;
    const meta = document.createElement("span");
    meta.className = "crm-supplier-meta";
    const due = s.next_due_at ? `الأداء ${readableDate(s.next_due_at)}` : "ما تحددش الأداء";
    meta.textContent = `${s.product_count || 0} منتج · ${due}${s.new_submissions ? ` · ${s.new_submissions} مرسلات جداد` : ""}`;
    main.append(title, badge, meta);
    const quick = document.createElement("div");
    quick.className = "crm-supplier-quick";
    const wa = document.createElement("input");
    wa.value = s.whatsapp || "";
    wa.placeholder = "واتساب";
    wa.dir = "ltr";
    wa.setAttribute("aria-label", "واتساب");
    const slug = document.createElement("input");
    slug.value = s.channel_slug || "";
    slug.placeholder = "slug";
    slug.dir = "ltr";
    slug.setAttribute("aria-label", "سيلغ المتجر");
    const st = document.createElement("select");
    for (const [v, label] of [["pending", "بانتظار"], ["active", "نشط"], ["paused", "موقوف"]]) {
      st.append(new Option(label, v));
    }
    st.value = s.status;
    const save = document.createElement("button");
    save.type = "button";
    save.className = "ghost";
    save.textContent = "حفظ الحالة";
    save.addEventListener("click", async () => {
      try {
        await j(`/api/suppliers/${s.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ whatsapp: wa.value.trim(), channel_slug: slug.value.trim().toLowerCase(), status: st.value }),
        });
        await loadSuppliers();
        await loadChannels();
        setNote("");
      } catch (err) {
        if (err.message !== "auth") setNote(err.message || "تعذر الحفظ");
      }
    });
    const link = document.createElement("span");
    link.className = "muted";
    link.textContent = s.channel_slug ? `/c/${s.channel_slug}` : "بلا متجر";
    quick.append(wa, slug, st, save, link);
    row.append(main, quick);
    box.append(row);
  }
}

async function openSupplierDetail(id) {
  selectedSupplierId = id;
  selectedSupplierDetail = await j(`/api/suppliers/${id}/detail`);
  $("supplier-directory").hidden = true;
  $("supplier-detail").hidden = false;
  renderSupplierDetail();
  $("view-supp").scrollIntoView({ block: "start" });
}

function renderSupplierDetail() {
  const data = selectedSupplierDetail;
  if (!data) return;
  const supplier = data.supplier;
  const sub = data.subscription;
  $("supplier-detail-name").textContent = supplier.name || `المورّد #${supplier.id}`;
  $("supplier-detail-meta").textContent = [`#${supplier.id}`, supplier.whatsapp, supplier.channel_slug ? `/c/${supplier.channel_slug}` : "", supplier.status === "active" ? "المتجر نشط" : "المتجر غير نشط"].filter(Boolean).join(" · ");
  $("link-channel-id").value = supplier.channel_id || "";
  $("link-channel-title").value = supplier.channel_title || "";
  $("link-channel-slug").value = supplier.channel_slug || "";
  $("channel-link-error").hidden = true;
  const phase = sub?.phase || "unconfigured";
  $("billing-phase").className = `billing-badge phase-${phase}`;
  $("billing-phase").textContent = billingLabels[phase] || phase;
  $("supplier-summary").replaceChildren(
    makeStat("كل المنتجات", String(data.summary.products || 0)),
    makeStat("المنتجات المنشورة", String(data.summary.published_products || 0)),
    makeStat("مجموع الأداءات", formatMoney(data.summary.total_paid_minor, sub?.currency || "MAD"), "good"),
    makeStat("الباقي فهاد الفترة", formatMoney(data.summary.outstanding_minor, sub?.currency || "MAD"), data.summary.outstanding_minor ? "warn" : ""),
  );
  $("b-plan").value = sub?.plan_name || "";
  $("b-amount").value = sub ? (Number(sub.amount_minor || 0) / 100).toFixed(2) : "";
  $("b-cycle").value = sub?.billing_cycle || "monthly";
  $("b-status").value = sub?.status || "active";
  $("b-period-start").value = sub?.period_start || "";
  $("b-period-end").value = sub?.period_end || "";
  $("b-next-due").value = sub?.next_due_at || "";
  $("b-grace").value = String(sub?.grace_days ?? 3);
  $("b-trial-end").value = sub?.trial_ends_at || "";
  $("b-follow-up").value = sub?.next_follow_up_at || "";
  $("b-note").value = sub?.internal_note || "";
  $("pay-amount").value = sub ? (Number(sub.amount_minor || 0) / 100).toFixed(2) : "";
  $("pay-date").value = isoToday();
  $("pay-period-start").value = sub?.period_start || isoToday();
  $("pay-period-end").value = sub?.period_end || cycleEnd($("pay-period-start").value, sub?.billing_cycle || "monthly");
  $("pay-next-due").value = sub?.next_due_at || $("pay-period-end").value;
  $("pay-reference").value = "";
  $("pay-note").value = "";
  renderPaymentHistory(data.payments, sub?.currency || "MAD");
  renderSupplierTimeline(data.timeline);
}

function renderPaymentHistory(payments, currency) {
  const box = $("payment-history");
  box.replaceChildren();
  if (!payments.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "ما تسجل حتى أداء دابا";
    box.append(empty);
    return;
  }
  const methodLabels = { cash: "نقدا", bank: "تحويل بنكي", wafacash: "Wafacash", cmi: "CMI", other: "أخرى" };
  for (const payment of payments) {
    const row = document.createElement("div");
    row.className = "payment-row";
    const amount = document.createElement("strong");
    amount.textContent = formatMoney(payment.amount_minor, payment.currency || currency);
    const copy = document.createElement("div");
    const meta = document.createElement("span");
    meta.textContent = `${readableDate(payment.paid_at)} · ${methodLabels[payment.method] || payment.method}`;
    const detail = document.createElement("small");
    detail.textContent = [payment.external_reference, payment.note, payment.period_start && payment.period_end ? `${readableDate(payment.period_start)} ← ${readableDate(payment.period_end)}` : ""].filter(Boolean).join(" · ");
    copy.append(meta, detail);
    row.append(amount, copy);
    box.append(row);
  }
}

function eventDescription(event) {
  const details = event.details || {};
  if (event.event_type === "admin_note") return details.text || "ملاحظة";
  if (event.event_type === "payment_recorded") return `تسجل أداء ${formatMoney(details.amount_minor, details.currency || "MAD")}`;
  if (event.event_type === "subscription_created") return `تسجل الاشتراك ${details.plan_name || ""}`.trim();
  if (event.event_type === "subscription_updated") return `تبدل الاشتراك${details.plan_name ? `: ${details.plan_name}` : ""}`;
  if (event.event_type === "supplier_created") return "تزاد المورّد";
  if (event.event_type === "supplier_updated") return "تبدلات معلومات أو حالة المورّد";
  if (event.event_type === "sessions_revoked") return `تسدات جلسات الدخول (${details.revoked || 0})`;
  if (event.event_type === "access_code_generated") return "تولد كود جديد للدخول";
  if (event.event_type === "supplier_login") return "دخل المورّد للوحة المنتجات";
  if (event.event_type === "supplier_logout") return "خرج المورّد من لوحة المنتجات";
  if (event.event_type === "channel_suggested") return `اقترح القناة: ${details.channel_title || "—"} (${details.channel_id || "بلا معرف"}) — بانتظار التأكيد`;
  if (event.event_type === "channel_linked") return `تأكد ربط القناة: ${details.channel_title || details.channel_id || "—"}`;
  if (event.event_type === "channel_linked_manual") return `ربطت الإدارة القناة يدويا: ${details.channel_title || details.channel_id || "—"}`;
  if (event.event_type === "product_edit") return `المورّد بدّل المنتج: ${details.product_name || `#${details.product_id}`}`;
  return event.event_type.replaceAll("_", " ");
}

function renderSupplierTimeline(events) {
  const box = $("supplier-timeline");
  box.replaceChildren();
  if (!events.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "ما كاين حتى نشاط مسجل";
    box.append(empty);
    return;
  }
  for (const event of events) {
    const item = document.createElement("div");
    item.className = "timeline-item";
    const dot = document.createElement("span");
    dot.className = "timeline-dot";
    const copy = document.createElement("div");
    const text = document.createElement("strong");
    text.textContent = eventDescription(event);
    const meta = document.createElement("small");
    meta.textContent = `${readableDate(event.created_at)} · ${event.actor === "supplier" ? "المورّد" : "الإدارة"}`;
    copy.append(text, meta);
    item.append(dot, copy);
    box.append(item);
  }
}

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
    p.textContent = "ما كاين والو هنا";
    box.append(p);
  }
  for (const sub of subs) {
    const row = document.createElement("div");
    row.className = "sub-row";
    if (sub.image) {
      const img = thumb(sub.image);
      img.className = "q-img";
      row.append(img);
    }
    const copy = document.createElement("div");
    copy.className = "sub-copy";
    const meta = document.createElement("div");
    meta.className = "q-meta";
    const supp = supplierById(sub.supplier_id);
    meta.textContent = [supp?.name || `#${sub.supplier_id}`, sub.status, sub.id ? `#${sub.id}` : ""].filter(Boolean).join(" · ");
    const txt = document.createElement("div");
    txt.className = "sub-text";
    txt.textContent = (sub.text || "").slice(0, 300) || "(بلا نص)";
    copy.append(meta, txt);
    const actions = document.createElement("div");
    actions.className = "sub-actions";
    const add = document.createElement("button");
    add.type = "button";
    add.className = "primary";
    add.textContent = "أضف للكاتالوغ";
    add.addEventListener("click", () => buildFromSubmission(sub));
    const skipBtn = document.createElement("button");
    skipBtn.type = "button";
    skipBtn.className = "ghost";
    skipBtn.textContent = "تخطي";
    skipBtn.addEventListener("click", async () => {
      await j("/api/submissions/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [sub.id], status: "skipped" }),
      });
      await loadSubs(true);
      await loadSuppliers();
    });
    actions.append(add, skipBtn);
    row.append(copy, actions);
    box.append(row);
  }
  $("subs-more").hidden = subs.length >= subsTotal;
}

function buildFromSubmission(sub) {
  const supp = supplierById(sub.supplier_id);
  resetEditorState();
  pendingSubmissionIds = [sub.id];
  pendingSupplierId = sub.supplier_id;
  selected.clear();
  renderSelection();
  setNote("");
  selImages = sub.image ? [sub.image] : [];
  const phones = supp?.whatsapp ? [supp.whatsapp] : [];
  emptyEl.hidden = true;
  editor.hidden = false;
  $("post-text").textContent = sub.text || "(بلا نص)";
  $("post-phone").hidden = phones.length === 0;
  $("post-phone").textContent = phones.length ? `واتساب المورّد: ${phones.join("، ")}` : "";
  $("f-name").value = suggestedName(sub.text || "");
  $("f-price").value = "";
  $("f-por").checked = false;
  $("f-stock").value = "";
  $("f-moq").value = "";
  $("f-desc").value = "";
  specs = [];
  renderSpecs();
  $("source").textContent = supp?.channel_title || supp?.name || "";
  formError.hidden = true;
  $("picker").hidden = true;
  renderSelImages();
  renderContact(phones);
  switchTab("posts");
  editor.scrollIntoView({ behavior: "smooth", block: "start" });
  $("f-name").focus();
}

async function refreshSupplierDetail() {
  if (!selectedSupplierId) return;
  selectedSupplierDetail = await j(`/api/suppliers/${selectedSupplierId}/detail`);
  renderSupplierDetail();
  await loadSuppliers();
}

$("supp-q").addEventListener("input", renderSuppliers);
$("supp-billing-filter").addEventListener("change", renderSuppliers);
$("channel-link-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedSupplierId) return;
  const error = $("channel-link-error");
  error.hidden = true;
  const submit = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    await j(`/api/suppliers/${selectedSupplierId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel_id: $("link-channel-id").value.trim(),
        channel_title: $("link-channel-title").value.trim(),
        channel_slug: $("link-channel-slug").value.trim().toLowerCase(),
      }),
    });
    await Promise.all([refreshSupplierDetail(), loadChannels()]);
  } catch (err) {
    error.hidden = false;
    error.textContent = err.message || "تعذر ربط القناة";
  } finally {
    submit.disabled = false;
  }
});
$("supplier-detail-back").addEventListener("click", () => {
  selectedSupplierId = null;
  selectedSupplierDetail = null;
  $("supplier-detail").hidden = true;
  $("supplier-directory").hidden = false;
});
$("b-period-start").addEventListener("change", () => {
  if (!$("b-period-end").value) $("b-period-end").value = cycleEnd($("b-period-start").value, $("b-cycle").value);
});
$("b-cycle").addEventListener("change", () => {
  if ($("b-period-start").value) $("b-period-end").value = cycleEnd($("b-period-start").value, $("b-cycle").value);
});
$("pay-period-start").addEventListener("change", () => {
  const cycle = selectedSupplierDetail?.subscription?.billing_cycle || "monthly";
  $("pay-period-end").value = cycleEnd($("pay-period-start").value, cycle);
  $("pay-next-due").value = $("pay-period-end").value;
});

$("subscription-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $("b-error");
  error.hidden = true;
  const amountMinor = dirhamToMinor($("b-amount").value);
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    error.hidden = false;
    error.textContent = "دخل مبلغ صحيح";
    return;
  }
  try {
    await j(`/api/suppliers/${selectedSupplierId}/subscription`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan_name: $("b-plan").value.trim(),
        amount_minor: amountMinor,
        currency: "MAD",
        billing_cycle: $("b-cycle").value,
        status: $("b-status").value,
        period_start: $("b-period-start").value,
        period_end: $("b-period-end").value,
        next_due_at: $("b-next-due").value,
        grace_days: Number($("b-grace").value),
        trial_ends_at: $("b-trial-end").value,
        next_follow_up_at: $("b-follow-up").value,
        internal_note: $("b-note").value.trim(),
      }),
    });
    await refreshSupplierDetail();
  } catch (err) {
    if (err.message === "auth") return;
    error.hidden = false;
    error.textContent = err.message || "تعذر حفظ الاشتراك";
  }
});

$("payment-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $("pay-error");
  error.hidden = true;
  const amountMinor = dirhamToMinor($("pay-amount").value);
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    error.hidden = false;
    error.textContent = "دخل مبلغ الأداء";
    return;
  }
  try {
    await j(`/api/suppliers/${selectedSupplierId}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount_minor: amountMinor,
        currency: "MAD",
        paid_at: $("pay-date").value,
        method: $("pay-method").value,
        external_reference: $("pay-reference").value.trim(),
        note: $("pay-note").value.trim(),
        period_start: $("pay-period-start").value,
        period_end: $("pay-period-end").value,
        next_due_at: $("pay-next-due").value,
      }),
    });
    await refreshSupplierDetail();
  } catch (err) {
    if (err.message === "auth") return;
    error.hidden = false;
    error.textContent = err.message || "تعذر تسجيل الأداء";
  }
});

$("timeline-note-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $("timeline-error");
  error.hidden = true;
  const text = $("timeline-note").value.trim();
  if (!text) return;
  try {
    await j(`/api/suppliers/${selectedSupplierId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    $("timeline-note").value = "";
    await refreshSupplierDetail();
  } catch (err) {
    if (err.message === "auth") return;
    error.hidden = false;
    error.textContent = err.message || "تعذر تسجيل الملاحظة";
  }
});

$("supplier-revoke").addEventListener("click", async () => {
  if (!selectedSupplierId || !confirm("واش باغي تسد جميع جلسات دخول هاد المورّد؟")) return;
  try {
    const result = await j(`/api/suppliers/${selectedSupplierId}/revoke-sessions`, { method: "POST" });
    await refreshSupplierDetail();
    setNote(`تسدات ${result.revoked || 0} جلسات دخول`);
  } catch (err) {
    if (err.message !== "auth") setNote(err.message || "تعذر إغلاق الجلسات");
  }
});

$("tab-posts").addEventListener("click", () => switchTab("posts"));
$("tab-products").addEventListener("click", () => switchTab("products"));
$("tab-subs").addEventListener("click", () => switchTab("subs"));
$("tab-supp").addEventListener("click", () => switchTab("supp"));
$("pub-supplier").addEventListener("change", () => loadPublished().catch((e) => setNote(e.message)));
$("pub-q").addEventListener("input", () => {
  clearTimeout(queryTimer);
  queryTimer = setTimeout(() => loadPublished().catch((e) => setNote(e.message)), 250);
});
$("subs-refresh").addEventListener("click", () => loadSubs(true).catch((e) => setNote(e.message)));
$("sub-status").addEventListener("change", () => loadSubs(true).catch((e) => setNote(e.message)));
$("sub-supplier").addEventListener("change", () => loadSubs(true).catch((e) => setNote(e.message)));
$("subs-more").addEventListener("click", () => loadSubs(false).catch((e) => setNote(e.message)));
$("supp-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const err = $("supp-error");
  err.hidden = true;
  try {
    await j("/api/suppliers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: $("s-name").value.trim(),
        whatsapp: $("s-whatsapp").value.trim(),
        channel_slug: $("s-slug").value.trim().toLowerCase(),
        telegram_id: $("s-tg").value.trim(),
        status: "pending",
      }),
    });
    $("s-name").value = "";
    $("s-whatsapp").value = "";
    $("s-slug").value = "";
    $("s-tg").value = "";
    await loadSuppliers();
    await loadChannels();
  } catch (e) {
    if (e.message === "auth") return;
    err.hidden = false;
    err.textContent = e.message || "تعذر إضافة المورّد";
  }
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
    await loadSubs(true);
    await loadSuppliers();
  } catch (e) {
    if (e.message === "auth") return;
    err.hidden = false;
    err.textContent = e.message || "تعذر الإضافة";
  }
});

try {
  cfg = await j("/api/config");
  await fillCategories();
  await loadChannels();
  await loadPublished();
  await loadPosts(true);
  await loadSuppliers();
  await loadSubs(true);
} catch (err) {
  if (err.message !== "auth") setNote(err.message || "تعذر التحميل");
}
