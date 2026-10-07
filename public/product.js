import { displayName, escapeHtml, mediaUrl, priceLabel, tierQtyLabel, tierRangeLabel, safeHttpUrl, thumbUrl } from "./format.js";
import { initLang, t } from "./i18n.js";
import { initOwnerContact } from "./owner-contact.js";

const $ = (id) => document.getElementById(id);
const main = $("g-main");
const thumbs = $("g-thumbs");

let product = null;
let index = 0;
let channelSlugs = {};

function contactOf(product) {
  const type = product.contact_type;
  if ((type === "whatsapp" || type === "whatsapp-msg") && product.contact) {
    const num = String(product.contact).replace(/[^\d]/g, "");
    if (!num) return null;
    const text = encodeURIComponent(`مرحباً، أود الاستفسار عن: ${displayName(product.name)}`);
    return { href: `https://wa.me/${num}?text=${text}`, label: t("contactWa"), kind: "whatsapp" };
  }
  if (type === "telegram") {
    const href = safeHttpUrl(product.channel || product.contact || "");
    if (!href) return null;
    return { href, label: t("contactTg"), kind: "telegram" };
  }
  return null;
}

// ---- templates ----
function thumbHtml(file, i) {
  return `<button type="button" aria-current="${i === index ? "true" : "false"}" data-index="${i}">
    <img src="${thumbUrl(file)}" data-full="${mediaUrl(file)}" alt="">
  </button>`;
}

function specHtml(spec) {
  return `<tr><th>${escapeHtml(spec.k)}</th><td>${escapeHtml(spec.v)}</td></tr>`;
}

// ---- render ----
function showPhoto() {
  const file = product?.images?.[index];
  if (!file) {
    main.removeAttribute("src");
    main.hidden = true;
    return;
  }
  main.hidden = false;
  main.src = mediaUrl(file);
}

function renderThumbs() {
  const images = product?.images || [];
  thumbs.hidden = images.length < 2;
  thumbs.innerHTML = images.map(thumbHtml).join("");
}

function renderChannel() {
  const el = $("g-channel");
  const name = product.source_channel || "";
  el.replaceChildren();
  el.hidden = !name;
  if (!name) return;
  const slug = (channelSlugs[name] || "");
  if (slug) {
    const a = document.createElement("a");
    a.href = `/c/${encodeURIComponent(slug)}`;
    a.textContent = name;
    el.append(a);
  } else {
    el.textContent = name;
  }
}
function renderSpecs() {
  const specs = product?.specs || [];
  $("g-specs").hidden = specs.length === 0;
  $("g-specs-table").innerHTML = specs.map(specHtml).join("");
}

function renderTiers() {
  const tiers = Array.isArray(product?.price_tiers) ? product.price_tiers : [];
  const section = $("g-tiers");
  if (!section) return;
  section.hidden = tiers.length === 0 || !!product?.price_on_request;
  if (section.hidden) return;
  $("g-tiers-table").innerHTML = tiers
    .map((tier) => `<tr><td>${escapeHtml(tierQtyLabel(tier))}</td><td>${escapeHtml(priceLabel(tier.price, t("currency")))}</td></tr>`)
    .join("");
}

function render() {
  if (!product) {
    $("notfound").hidden = false;
    return;
  }
  $("product").hidden = false;
  const title = displayName(product.name);
  document.title = `${title} — Jemlix`;
  $("g-name").textContent = title;
  const crumb = $("crumb-name");
  if (crumb) crumb.textContent = title;
  renderChannel();
  const tiers = Array.isArray(product.price_tiers) ? product.price_tiers : [];
  const price = product.price_on_request ? t("priceOnRequest") : tiers.length
    ? tierRangeLabel(tiers, t("currency"))
    : priceLabel(product.price, t("currency"));
  $("g-price").textContent = price;
  $("g-price").hidden = !price;
  $("g-moq").textContent = product.moq || "";
  $("g-stock").textContent = product.stock || "";
  $("g-facts").hidden = !product.moq && !product.stock;

  const contact = contactOf(product);
  const c = $("g-contact");
  const sb = $("sticky-buy");
  const sc = $("s-contact");
  const sp = $("s-price");
  if (contact) {
    c.hidden = false;
    c.href = contact.href;
    c.textContent = contact.label;
    c.className = `contact ${contact.kind}`;
    if (sb && sc && sp) {
      sb.hidden = false;
      sc.hidden = false;
      sc.href = contact.href;
      sc.textContent = contact.label;
      sc.className = `contact ${contact.kind}`;
      sp.textContent = price;
      sp.hidden = !price;
    }
  } else {
    c.hidden = true;
    if (sb) sb.hidden = true;
  }

  $("g-desc-text").textContent = product.description || "";
  $("g-desc").hidden = !product.description;

  index = 0;
  showPhoto();
  renderThumbs();
  renderTiers();
  renderSpecs();
}

// ---- events ----
thumbs.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-index]");
  if (!button) return;
  index = Number(button.dataset.index);
  showPhoto();
  renderThumbs();
});

thumbs.addEventListener(
  "error",
  (event) => {
    const img = event.target;
    if (img instanceof HTMLImageElement && img.dataset.full && img.getAttribute("src") !== img.dataset.full) {
      img.src = img.dataset.full;
    }
  },
  true,
);

// ---- load ----
async function load() {
  const match = location.pathname.match(/^\/p\/(\d+)$/);
  if (!match) {
    $("notfound").hidden = false;
    return;
  }
  try {
    const [res, chanRes] = await Promise.all([fetch(`/api/products/${match[1]}`), fetch("/api/channels")]);
    if (!res.ok) throw new Error("notfound");
    product = await res.json();
    if (chanRes?.ok) {
      channelSlugs = Object.fromEntries((await chanRes.json()).map((ch) => [ch.name, ch.slug]));
    }
    render();
  } catch {
    $("notfound").hidden = false;
  }
}

initLang();
document.addEventListener("jemla:lang", () => render());
initOwnerContact();
load();
