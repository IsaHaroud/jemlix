import { displayName, escapeHtml, mediaUrl, priceLabel, safeHttpUrl, thumbUrl } from "./format.js";
import { catLabel, countLabel, initLang, moqLabel, t } from "./i18n.js";

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
  return products.filter((product) => {
    if (activeCat && product.category !== activeCat) return false;
    if (!q) return true;
    return `${product.name || ""} ${product.description || ""}`.toLowerCase().includes(q);
  });
}

// ---- templates ----
function cardHtml(product) {
  const file = product.images?.[0];
  const price = priceLabel(product.price, t("currency"), product.price_on_request ? t("priceOnRequest") : "");
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

// ---- events ----
search.addEventListener("input", renderCards);

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
load();
