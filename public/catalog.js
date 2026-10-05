import { displayName, escapeHtml, mediaUrl, priceLabel, priceNumbers, safeHttpUrl, thumbUrl, tierRangeLabel } from "./format.js";
import { catLabel, countLabel, initLang, moqLabel, t } from "./i18n.js";
import { initOwnerContact } from "./owner-contact.js";

const search = document.getElementById("search");
const catsEl = document.getElementById("cats");
const grid = document.getElementById("grid");
const countEl = document.getElementById("count");
const none = document.getElementById("none");
const categoriesDialog = document.getElementById("categories-dialog");
const categoriesGrid = document.getElementById("categories-grid");

let products = [];
let cats = [];
let channels = [];
let activeCat = "";
let sortMode = "newest";

const sortSel = document.getElementById("sort");
const minPriceEl = document.getElementById("min-price");
const maxPriceEl = document.getElementById("max-price");

function syncCatalogMeta() {
  if (storeSlug()) return;
  document.title = t("catalogTitle");
  const description = document.querySelector('meta[name="description"]');
  if (description) description.setAttribute("content", t("catalogDescription"));
}

// ---- helpers ----
function storeSlugFor(name) {
  const hit = channels.find((ch) => ch.name === name);
  return hit ? hit.slug : "";
}
function contactOf(product) {
  const type = product.contact_type;
  if ((type === "whatsapp" || type === "whatsapp-msg") && product.contact) {
    const num = String(product.contact).replace(/[^\d]/g, "");
    if (!num) return null;
    const text = encodeURIComponent(`مرحباً، أود الاستفسار عن: ${displayName(product.name)}`);
    return { href: `https://wa.me/${num}?text=${text}`, kind: "whatsapp" };
  }
  if (type === "telegram") {
    const href = safeHttpUrl(product.channel || product.contact || "");
    if (!href) return null;
    return { href, kind: "telegram" };
  }
  return null;
}

function visible() {
  const q = search.value.trim().toLowerCase();
  const min = minPriceEl.value === "" ? null : Number(minPriceEl.value);
  const max = maxPriceEl.value === "" ? null : Number(maxPriceEl.value);
  const priceFiltered = min !== null || max !== null;
  const list = products.filter((product) => {
    if (activeCat && product.category !== activeCat) return false;
    if (q && !`${product.name || ""} ${product.description || ""}`.toLowerCase().includes(q)) return false;
    if (priceFiltered) {
      const nums = priceNumbers(product);
      if (!nums.length) return false;
      if (min !== null && !nums.some((n) => n >= min)) return false;
      if (max !== null && !nums.some((n) => n <= max)) return false;
    }
    return true;
  });
  const byIdDesc = (a, b) => (b.id || 0) - (a.id || 0);
  const byDate = (a, b) =>
    String(b.created_at || "").localeCompare(String(a.created_at || "")) || byIdDesc(a, b);
  switch (sortMode) {
    case "oldest":
      list.sort((a, b) => byDate(b, a));
      break;
    case "price-asc":
      list.sort((a, b) => {
        const pa = priceNum(a);
        const pb = priceNum(b);
        if (pa === null && pb === null) return byIdDesc(a, b);
        if (pa === null) return 1;
        if (pb === null) return -1;
        return pa - pb || byIdDesc(a, b);
      });
      break;
    case "price-desc":
      list.sort((a, b) => {
        const pa = priceNum(a);
        const pb = priceNum(b);
        if (pa === null && pb === null) return byIdDesc(a, b);
        if (pa === null) return 1;
        if (pb === null) return -1;
        return pb - pa || byIdDesc(a, b);
      });
      break;
    case "name":
      list.sort((a, b) =>
        String(displayName(a.name)).localeCompare(String(displayName(b.name)), undefined, { sensitivity: "base" }) ||
        byIdDesc(a, b),
      );
      break;
    case "newest":
    default:
      list.sort(byDate);
      break;
  }
  return list;
}

// Lowest unit price on a product (base or any tier) or null.
function priceNum(product) {
  const nums = priceNumbers(product);
  return nums.length ? Math.min(...nums) : null;
}

// ---- templates ----
function cardHtml(product) {
  const file = product.images?.[0];
  const tiers = Array.isArray(product.price_tiers) ? product.price_tiers : [];
  const price = tiers.length
    ? tierRangeLabel(tiers, t("currency"))
    : priceLabel(product.price, t("currency"), product.price_on_request ? t("priceOnRequest") : "");
  const contact = contactOf(product);
  const alt = escapeHtml(displayName(product.name));
  return `
    <article class="card">
      <div class="card-hit" data-href="/p/${product.id}" role="link" tabindex="0">
        <span class="photo${file ? "" : " no-img"}">
          ${file ? `<img src="${thumbUrl(file)}" data-full="${mediaUrl(file)}" alt="${alt}" loading="lazy" decoding="async">` : ""}
        </span>
        <span class="body">
          <span class="name" dir="auto">${alt}</span>
          ${
            price || product.moq
              ? `<span class="meta">
                   ${price ? `<span class="price">${escapeHtml(price)}</span>` : ""}
                   ${product.moq ? `<span class="badge-moq">${escapeHtml(moqLabel(product.moq))}</span>` : ""}
                 </span>`
              : ""
          }
          ${product.source_channel ? `<span class="channel">${storeSlugFor(product.source_channel) ? `<a href="/c/${encodeURIComponent(storeSlugFor(product.source_channel))}">${escapeHtml(product.source_channel)}</a>` : escapeHtml(product.source_channel)}</span>` : ""}
        </span>
      </div>
      ${
        contact
          ? `<div class="card-foot">
               <a class="chat ${contact.kind}" href="${escapeHtml(contact.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t("contact"))}</a>
             </div>`
          : ""
      }
    </article>`;
}

function chipHtml(item) {
  const pressed = item.value === activeCat ? "true" : "false";
  return `<button type="button" class="chip" data-value="${escapeHtml(item.value)}" aria-pressed="${pressed}">${escapeHtml(item.label)}</button>`;
}

function categoryOptionHtml(item, counts) {
  const pressed = item.value === activeCat ? "true" : "false";
  const count = item.value ? counts.get(item.value) || 0 : products.length;
  const mark = item.value ? item.label.trim().charAt(0) : "J";
  return `<button type="button" class="category-option" data-value="${escapeHtml(item.value)}" aria-pressed="${pressed}">
    <span class="category-option-mark">${escapeHtml(mark)}</span>
    <span class="category-option-copy"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(countLabel(count))}</small></span>
  </button>`;
}

function skeletonHtml() {
  return `<div class="skel"><div class="ph"></div><div class="ln"></div><div class="ln short"></div></div>`;
}

// ---- render ----
function renderSkeletons(n = 10) {
  grid.innerHTML = Array.from({ length: n }, skeletonHtml).join("");
}

function renderCards() {
  const list = visible();
  countEl.textContent = countLabel(list.length);
  none.hidden = list.length > 0;
  grid.innerHTML = list.map(cardHtml).join("");
}

function renderStores(list, currentSlug) {
  if (list) channels = list;
  const sec = document.getElementById("stores");
  const box = document.getElementById("store-list");
  if (!box || currentSlug || !channels.length) {
    if (sec) sec.hidden = true;
    return;
  }
  sec.hidden = false;
  box.replaceChildren();
  for (const ch of channels) {
    const a = document.createElement("a");
    a.className = "store-chip";
    a.href = `/c/${encodeURIComponent(ch.slug)}`;
    const ava = document.createElement("span");
    ava.className = "store-ava sm";
    ava.textContent = (ch.name || "J").trim().charAt(0);
    const copy = document.createElement("span");
    copy.className = "store-chip-copy";
    const nm = document.createElement("span");
    nm.className = "store-chip-name";
    nm.textContent = ch.name;
    const ct = document.createElement("span");
    ct.className = "store-chip-count";
    ct.textContent = countLabel(ch.count);
    copy.append(nm, ct);
    a.append(ava, copy);
    box.append(a);
  }
}
function syncChips() {
  for (const button of document.querySelectorAll("#cats [data-value], #categories-grid [data-value]")) {
    button.setAttribute("aria-pressed", button.dataset.value === activeCat ? "true" : "false");
  }
}

function renderCats(categories) {
  cats = categories || [];
  const counts = new Map();
  for (const product of products) {
    counts.set(product.category, (counts.get(product.category) || 0) + 1);
  }
  const items = [{ label: t("allCats"), value: "" }, ...cats.map((name) => ({ label: catLabel(name), value: name }))];
  catsEl.innerHTML = items.map(chipHtml).join("");
  categoriesGrid.innerHTML = items.map((item) => categoryOptionHtml(item, counts)).join("");
}

function chooseCategory(value) {
  activeCat = value || "";
  syncChips();
  renderCards();
  if (categoriesDialog.open) categoriesDialog.close();
}

const SORT_MODES = ["newest", "oldest", "price-asc", "price-desc", "name"];

function sortLabel(mode) {
  return t(
    mode === "oldest" ? "sortOldest"
      : mode === "price-asc" ? "sortPriceAsc"
        : mode === "price-desc" ? "sortPriceDesc"
          : mode === "name" ? "sortName"
            : "sortNewest",
  );
}

function renderToolbar() {
  const current = SORT_MODES.includes(sortMode) ? sortMode : "newest";
  sortMode = current;
  sortSel.setAttribute("aria-label", t("sort"));
  sortSel.replaceChildren(
    ...SORT_MODES.map((mode) => {
      const opt = document.createElement("option");
      opt.value = mode;
      opt.textContent = sortLabel(mode);
      if (mode === current) opt.selected = true;
      return opt;
    }),
  );
}

function resetFilters() {
  search.value = "";
  minPriceEl.value = "";
  maxPriceEl.value = "";
  sortMode = "newest";
  renderToolbar();
  chooseCategory("");
}

// ---- events ----
search.addEventListener("input", renderCards);
sortSel.addEventListener("change", () => {
  sortMode = sortSel.value;
  renderCards();
});
minPriceEl.addEventListener("input", renderCards);
maxPriceEl.addEventListener("input", renderCards);
document.getElementById("reset-filters").addEventListener("click", resetFilters);

// card navigation (inner links like the store link keep their own target)
grid.addEventListener("click", (event) => {
  if (event.target.closest("a")) return;
  const hit = event.target.closest(".card-hit");
  if (hit?.dataset.href) location.href = hit.dataset.href;
});
grid.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  if (event.target.closest("a")) return;
  const hit = event.target.closest(".card-hit");
  if (hit?.dataset.href) location.href = hit.dataset.href;
});

catsEl.addEventListener("click", (event) => {
  const chip = event.target.closest(".chip");
  if (!chip) return;
  chooseCategory(chip.dataset.value);
});

categoriesGrid.addEventListener("click", (event) => {
  const option = event.target.closest(".category-option");
  if (option) chooseCategory(option.dataset.value);
});
document.getElementById("categories-open").addEventListener("click", () => categoriesDialog.showModal());
document.getElementById("categories-close").addEventListener("click", () => categoriesDialog.close());
categoriesDialog.addEventListener("click", (event) => {
  if (event.target === categoriesDialog) categoriesDialog.close();
});

// thumbnail → full image fallback (error does not bubble, so capture)
grid.addEventListener(
  "error",
  (event) => {
    const img = event.target;
    if (img instanceof HTMLImageElement && img.dataset.full && img.getAttribute("src") !== img.dataset.full) {
      img.src = img.dataset.full;
    }
  },
  true,
);

document.addEventListener("jemla:lang", () => {
  syncCatalogMeta();
  renderCats(cats);
  renderToolbar();
  renderCards();
  renderStores();
  updateStoreSub();
});

// ---- store page ----
function storeSlug() {
  const match = location.pathname.match(/^\/c\/([^/]+)$/);
  return match ? match[1] : null;
}

function updateStoreSub() {
  if (!storeSlug() || !products.length) return;
  const el = document.getElementById("store-sub");
  if (el) el.textContent = countLabel(products.length);
}

async function load() {
  renderSkeletons();
  try {
    const slug = storeSlug();
    const storeEl = document.getElementById("store");
    const storeNameEl = document.getElementById("store-name");
    let productUrl = "/api/products";
    if (slug) {
      const storeRes = await fetch(`/api/channels/${slug}`);
      if (!storeRes.ok) throw new Error("store");
      const store = await storeRes.json();
      storeEl.hidden = false;
      storeNameEl.textContent = store.name;
      const ava = document.getElementById("store-ava");
      if (ava) ava.textContent = (store.name || "J").trim().charAt(0);
      document.title = `${store.name} — Jemlix`;
      productUrl = `/api/products?channel=${encodeURIComponent(store.name)}`;
    } else {
      storeEl.hidden = true;
    }
    const [productRes, categoryRes, channelRes] = await Promise.all([fetch(productUrl), fetch("/api/categories"), fetch("/api/channels")]);
    if (!productRes.ok || !categoryRes.ok) throw new Error("load");
    products = await productRes.json();
    renderCats(await categoryRes.json());
    renderCards();
    updateStoreSub();
    if (channelRes?.ok) renderStores(await channelRes.json(), slug);
  } catch {
    countEl.textContent = "";
    none.hidden = false;
    const strong = none.querySelector("strong");
    if (strong) strong.textContent = t("loadError");
    else none.textContent = t("loadError");
  }
}

initLang();
syncCatalogMeta();
renderToolbar();
initOwnerContact();
load();
