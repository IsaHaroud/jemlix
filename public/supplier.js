import { displayName, priceLabel, thumbUrl, mediaUrl } from "./format.js";
import { getLang, initLang } from "./i18n.js";

const COPY = {
  ar: {
    pageTitle: "Jemlix — إدارة المنتجات", portal: "مساحة المورّد", logout: "تسجيل الخروج",
    loginTitle: "أدخل رمز الدخول", loginHelp: 'أرسل <bdi dir="ltr">/code</bdi> إلى البوت على تيليغرام، ثم انسخ الرمز الذي سيظهر لك.',
    loginCode: "رمز الدخول", login: "دخول", codeValidity: "الرمز صالح لمدة 10 دقائق ولاستخدام واحد.",
    yourProducts: "منتجاتك", store: "المتجر", viewStore: "عرض المتجر ↗", search: "بحث",
    searchPlaceholder: "البحث بالاسم أو الوصف", allProducts: "جميع المنتجات", visibleProducts: "المنتجات الظاهرة",
    hiddenProducts: "المنتجات المخفية", previous: "السابق", next: "التالي", editProduct: "تعديل المنتج",
    price: "السعر (درهم)", priceOnRequest: "السعر عند الطلب", stock: "المخزون", stockPlaceholder: "متوفر / 100 قطعة",
    minimum: "الحد الأدنى للطلب", description: "الوصف", visibleInCatalog: "ظاهر في الدليل", cancel: "إلغاء",
    save: "حفظ التغييرات", supplier: "المورّد", noPrice: "دون سعر", minimumShort: "الحد الأدنى",
    noMinimum: "دون حد أدنى", noStock: "المخزون غير محدد", visible: "ظاهر", hidden: "مخفي", edit: "تعديل",
    noProducts: "لم نعثر على أي منتج", noProductsHelp: "غيّر البحث أو عامل التصفية ثم حاول مرة أخرى.",
    productStatus: "حالة المنتجات", close: "إغلاق", codeIncomplete: "أدخل الرمز كاملاً: 6 أرقام",
    operationError: "تعذر إتمام العملية", invalidCode: "رمز الدخول غير صالح أو انتهت صلاحيته.",
  },
  fr: {
    pageTitle: "Jemlix — Gestion des produits", portal: "Espace fournisseur", logout: "Déconnexion",
    loginTitle: "Saisissez votre code d’accès", loginHelp: 'Envoyez <bdi dir="ltr">/code</bdi> au bot Telegram, puis copiez le code reçu.',
    loginCode: "Code d’accès", login: "Connexion", codeValidity: "Le code est valable 10 minutes et pour une seule utilisation.",
    yourProducts: "Vos produits", store: "Boutique", viewStore: "Voir la boutique ↗", search: "Rechercher",
    searchPlaceholder: "Rechercher par nom ou description", allProducts: "Tous les produits", visibleProducts: "Produits visibles",
    hiddenProducts: "Produits masqués", previous: "Précédent", next: "Suivant", editProduct: "Modifier le produit",
    price: "Prix (MAD)", priceOnRequest: "Prix sur demande", stock: "Stock", stockPlaceholder: "Disponible / 100 pièces",
    minimum: "Minimum de commande", description: "Description", visibleInCatalog: "Visible dans le catalogue", cancel: "Annuler",
    save: "Enregistrer", supplier: "Fournisseur", noPrice: "Sans prix", minimumShort: "Minimum",
    noMinimum: "Sans minimum", noStock: "Stock non défini", visible: "Visible", hidden: "Masqué", edit: "Modifier",
    noProducts: "Aucun produit trouvé", noProductsHelp: "Modifiez la recherche ou le filtre, puis réessayez.",
    productStatus: "État des produits", close: "Fermer", codeIncomplete: "Saisissez les 6 chiffres du code.",
    operationError: "Impossible d’effectuer l’opération", invalidCode: "Le code est invalide ou a expiré.",
  },
};

function sp(key) {
  return COPY[getLang()]?.[key] || COPY.ar[key] || key;
}

function translateSupplierPage() {
  document.title = sp("pageTitle");
  for (const el of document.querySelectorAll("[data-sp]")) el.textContent = sp(el.dataset.sp);
  for (const el of document.querySelectorAll("[data-sp-html]")) el.innerHTML = sp(el.dataset.spHtml);
  for (const el of document.querySelectorAll("[data-sp-ph]")) el.placeholder = sp(el.dataset.spPh);
  $("supplier-status").setAttribute("aria-label", sp("productStatus"));
  $("supplier-edit-close").setAttribute("aria-label", sp("close"));
}

const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 25;
let supplier = null;
let products = [];
let current = null;
let offset = 0;
let total = 0;
let searchTimer = 0;
let lastData = null;

async function api(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "تعذر إتمام العملية");
    error.status = response.status;
    throw error;
  }
  return data;
}

function setLoginError(message) {
  const el = $("supplier-login-error");
  el.hidden = !message;
  el.textContent = message || "";
}

function setNote(message) {
  const el = $("supplier-note");
  el.hidden = !message;
  el.textContent = message || "";
}

function showLogin() {
  supplier = null;
  $("supplier-login").hidden = false;
  $("supplier-app").hidden = true;
  $("supplier-logout").hidden = true;
  $("supplier-name").textContent = "";
  setTimeout(() => $("supplier-code").focus(), 0);
}

function showApp() {
  $("supplier-login").hidden = true;
  $("supplier-app").hidden = false;
  $("supplier-logout").hidden = false;
  $("supplier-name").textContent = supplier.name || sp("supplier");
  $("supplier-store-name").textContent = supplier.channel_title || supplier.name || sp("store");
  const link = $("supplier-store-link");
  if (supplier.channel_slug) {
    link.href = `/c/${encodeURIComponent(supplier.channel_slug)}`;
    link.hidden = false;
  } else {
    link.hidden = true;
  }
}

function productRow(product) {
  const row = document.createElement("article");
  row.className = "supplier-product";

  const image = document.createElement("span");
  image.className = "supplier-product-image";
  if (product.images?.[0]) {
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.src = thumbUrl(product.images[0]);
    img.addEventListener("error", () => {
      const full = mediaUrl(product.images[0]);
      if (img.getAttribute("src") !== full) img.src = full;
    });
    image.append(img);
  }

  const copy = document.createElement("div");
  copy.className = "supplier-product-copy";
  const title = document.createElement("h2");
  title.textContent = displayName(product.name);
  title.dir = "auto";
  const meta = document.createElement("p");
  meta.className = "muted";
  const price = priceLabel(product.price, getLang() === "fr" ? "MAD" : "د.م", product.price_on_request ? sp("priceOnRequest") : "");
  meta.textContent = [price || sp("noPrice"), product.moq ? `${sp("minimumShort")} ${product.moq}` : sp("noMinimum"), product.stock || sp("noStock")].join(" · ");
  const status = document.createElement("span");
  status.className = `supplier-status ${product.published ? "active" : "hidden"}`;
  status.textContent = product.published ? sp("visible") : sp("hidden");
  copy.append(title, meta, status);

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "ghost";
  edit.textContent = sp("edit");
  edit.addEventListener("click", () => openEditor(product));
  row.append(image, copy, edit);
  return row;
}

function renderProducts(data) {
  lastData = data;
  products = data.items || [];
  total = data.total || 0;
  const box = $("supplier-products");
  box.replaceChildren();
  if (!products.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    const title = document.createElement("strong");
    title.textContent = sp("noProducts");
    const text = document.createElement("span");
    text.textContent = sp("noProductsHelp");
    empty.append(title, text);
    box.append(empty);
  } else {
    for (const product of products) box.append(productRow(product));
  }
  const counts = data.counts || {};
  $("supplier-summary").textContent = getLang() === "fr"
    ? `${counts.all_count || 0} produits · ${counts.active || 0} visibles · ${counts.hidden || 0} masqués`
    : `${counts.all_count || 0} منتج · ${counts.active || 0} ظاهر · ${counts.hidden || 0} مخفي`;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  $("supplier-page").textContent = getLang() === "fr" ? `Page ${page} sur ${pages}` : `الصفحة ${page} من ${pages}`;
  $("supplier-prev").disabled = offset === 0;
  $("supplier-next").disabled = offset + products.length >= total;
  $("supplier-prev").parentElement.hidden = total <= PAGE_SIZE;
}

async function loadProducts(reset = false) {
  if (reset) offset = 0;
  setNote("");
  const params = new URLSearchParams({
    q: $("supplier-q").value.trim(),
    status: $("supplier-status").value,
    offset: String(offset),
    limit: String(PAGE_SIZE),
  });
  try {
    renderProducts(await api(`/api/supplier/products?${params}`));
  } catch (error) {
    if (error.status === 401) return showLogin();
    setNote(getLang() === "fr" ? sp("operationError") : error.message);
  }
}

function openEditor(product) {
  current = product;
  $("supplier-edit-name").textContent = displayName(product.name);
  $("supplier-edit-name").dir = "auto";
  $("supplier-edit-price").value = product.price || "";
  $("supplier-edit-por").checked = !!product.price_on_request;
  $("supplier-edit-stock").value = product.stock || "";
  $("supplier-edit-moq").value = product.moq || "";
  $("supplier-edit-desc").value = product.description || "";
  $("supplier-edit-published").checked = !!product.published;
  $("supplier-edit-error").hidden = true;
  $("supplier-editor").showModal();
}

function closeEditor() {
  current = null;
  $("supplier-editor").close();
}

$("supplier-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  setLoginError("");
  const code = $("supplier-code").value.replace(/\D/g, "").slice(0, 6);
  if (code.length !== 6) return setLoginError(sp("codeIncomplete"));
  const submit = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    await api("/api/supplier/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    $("supplier-code").value = "";
    await init();
  } catch (error) {
    setLoginError(getLang() === "fr" ? (error.status === 401 ? sp("invalidCode") : sp("operationError")) : error.message);
  } finally {
    submit.disabled = false;
  }
});

$("supplier-code").addEventListener("input", (event) => {
  event.target.value = event.target.value.replace(/\D/g, "").slice(0, 6);
});

$("supplier-logout").addEventListener("click", async () => {
  await fetch("/api/supplier/logout", { method: "POST" });
  showLogin();
});

$("supplier-q").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadProducts(true), 250);
});
$("supplier-status").addEventListener("change", () => loadProducts(true));
$("supplier-prev").addEventListener("click", () => {
  offset = Math.max(0, offset - PAGE_SIZE);
  loadProducts();
  scrollTo({ top: 0, behavior: "smooth" });
});
$("supplier-next").addEventListener("click", () => {
  offset += PAGE_SIZE;
  loadProducts();
  scrollTo({ top: 0, behavior: "smooth" });
});

$("supplier-edit-close").addEventListener("click", closeEditor);
$("supplier-edit-cancel").addEventListener("click", closeEditor);
$("supplier-editor").addEventListener("click", (event) => {
  if (event.target === $("supplier-editor")) closeEditor();
});
$("supplier-edit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!current) return;
  const errorEl = $("supplier-edit-error");
  errorEl.hidden = true;
  const save = $("supplier-edit-save");
  save.disabled = true;
  try {
    await api(`/api/supplier/products/${current.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        price: $("supplier-edit-price").value.trim(),
        price_on_request: $("supplier-edit-por").checked,
        stock: $("supplier-edit-stock").value.trim(),
        moq: $("supplier-edit-moq").value.trim(),
        description: $("supplier-edit-desc").value.trim(),
        published: $("supplier-edit-published").checked,
      }),
    });
    closeEditor();
    await loadProducts();
  } catch (error) {
    if (error.status === 401) {
      closeEditor();
      return showLogin();
    }
    errorEl.hidden = false;
    errorEl.textContent = getLang() === "fr" ? sp("operationError") : error.message;
  } finally {
    save.disabled = false;
  }
});

async function init() {
  try {
    supplier = await api("/api/supplier/me");
    showApp();
    await loadProducts(true);
  } catch {
    showLogin();
  }
}

document.addEventListener("jemla:lang", () => {
  translateSupplierPage();
  if (supplier) showApp();
  if (lastData) renderProducts(lastData);
});

initLang();
translateSupplierPage();
init();
