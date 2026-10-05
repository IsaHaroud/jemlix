// Fills public owner-contact links (About CTA + footer) from /api/config.
// Shown only when OWNER_WHATSAPP / BOT_USERNAME are configured server-side.
let cachedConfig = null;

async function ownerConfig() {
  if (cachedConfig) return cachedConfig;
  try {
    const res = await fetch("/api/config");
    cachedConfig = res.ok ? await res.json() : {};
  } catch {
    cachedConfig = {};
  }
  return cachedConfig;
}

function waLink(number, text) {
  const digits = String(number || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

function tgLink(username) {
  const name = String(username || "").replace(/^@/, "");
  return name ? `https://t.me/${name}` : "";
}

export async function initOwnerContact() {
  const cfg = await ownerConfig();
  const lang = document.documentElement.lang === "fr" ? "fr" : "ar";
  const wa = waLink(cfg.ownerWhatsapp, "");
  const tg = tgLink(cfg.botUsername);
  if (!wa && !tg) {
    for (const sec of document.querySelectorAll("[data-owner-cta]")) sec.hidden = true;
    return;
  }
  const fillButtons = () => {
    const langNow = document.documentElement.lang === "fr" ? "fr" : "ar";
    const waText = (el) => el.dataset[`waText${langNow === "fr" ? "Fr" : "Ar"}`] || "";
    for (const el of document.querySelectorAll("[data-owner-wa]")) {
      const href = waLink(cfg.ownerWhatsapp, waText(el));
      if (href) el.href = href;
      else el.hidden = true;
    }
    for (const el of document.querySelectorAll("[data-owner-tg]")) {
      if (tg) el.href = tg;
      else el.hidden = true;
    }
  };
  fillButtons();
  document.addEventListener("jemla:lang", fillButtons);
  // Footer "contact us" link on every page (nav exists in catalog/product/about/blog).
  const nav = document.querySelector('nav.footer-col[aria-label="Suppliers"]');
  const paintFooter = () => {
    if (!nav) return;
    const langNow = document.documentElement.lang === "fr" ? "fr" : "ar";
    let a = nav.querySelector("[data-owner-footer]");
    if (!a) {
      a = document.createElement("a");
      a.dataset.ownerFooter = "1";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      nav.append(a);
    }
    if (wa) {
      a.href = waLink(cfg.ownerWhatsapp, langNow === "fr" ? "Bonjour, je suis grossiste et je veux vendre sur Jemlix." : "السلام، أنا مورّد جملة وبغيت نعرض المنتجات ديالي فـ Jemlix.");
      a.textContent = langNow === "fr" ? "Contactez-nous" : "تواصل معنا";
    } else {
      a.href = tg;
      a.textContent = langNow === "fr" ? "Démarrer avec le bot" : "بدا مع البوت";
    }
  };
  paintFooter();
  document.addEventListener("jemla:lang", paintFooter);
}
