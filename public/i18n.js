const CATEGORIES = {
  "ملابس رجال": "Vêtements homme",
  "ملابس نساء": "Vêtements femme",
  "ملابس أطفال": "Vêtements enfant",
  "أحذية": "Chaussures",
  "حقائب": "Sacs",
  "ساعات ونظارات": "Montres & lunettes",
  "اكسسوارات": "Accessoires",
  "كوزمتيك وتجميل": "Cosmétique & beauté",
  "عطور": "Parfums",
  "صحة وعناية": "Santé & soins",
  "إلكترونيات": "Électronique",
  "هواتف وإكسسوارات": "Téléphones & accessoires",
  "حواسيب ومستلزمات المكتب": "Informatique & fournitures de bureau",
  "أجهزة منزلية": "Électroménager",
  "مطبخ وأواني": "Cuisine & ustensiles",
  "أثاث وديكور": "Meubles & déco",
  "لوازم الأم والطفل": "Maman & bébé",
  "لعب أطفال": "Jouets",
  "مواد غذائية": "Alimentation",
  "مشروبات": "Boissons",
  "تنظيف": "Nettoyage",
  "مكتبة ولوازم مدرسية": "Papeterie & fournitures scolaires",
  "تغليف ومستلزمات المتاجر": "Emballage & équipement de magasin",
  "أدوات ومعدات": "Outils & équipements",
  "معدات مهنية وصناعية": "Équipements professionnels & industriels",
  "سيارات وقطع غيار": "Auto & pièces",
  "مواد بناء": "Matériaux de construction",
  "حديقة وفلاحة": "Jardin & agriculture",
  "رياضة": "Sport",
  "أقمشة ونسيج": "Tissus & textile",
  "منتجات تقليدية وحرفية": "Artisanat & produits traditionnels",
  "حيوانات أليفة": "Animaux",
  "أخرى": "Autre",
};

const AR_CATEGORIES = {
  "ملابس رجال": "ملابس رجالية",
  "ملابس نساء": "ملابس نسائية",
  "ملابس أطفال": "ملابس الأطفال",
  "اكسسوارات": "إكسسوارات",
  "كوزمتيك وتجميل": "مستحضرات التجميل",
  "صحة وعناية": "الصحة والعناية الشخصية",
  "هواتف وإكسسوارات": "الهواتف وملحقاتها",
  "حواسيب ومستلزمات المكتب": "الحواسيب ومستلزمات المكتب",
  "مطبخ وأواني": "المطبخ والأواني",
  "لوازم الأم والطفل": "مستلزمات الأم والطفل",
  "لعب أطفال": "ألعاب الأطفال",
  "مشروبات": "المشروبات",
  "تنظيف": "مواد التنظيف",
  "مكتبة ولوازم مدرسية": "القرطاسية واللوازم المدرسية",
  "تغليف ومستلزمات المتاجر": "التغليف ومستلزمات المتاجر",
  "أدوات ومعدات": "الأدوات والمعدات",
  "معدات مهنية وصناعية": "المعدات المهنية والصناعية",
  "سيارات وقطع غيار": "السيارات وقطع الغيار",
  "حديقة وفلاحة": "الحدائق والزراعة",
  "منتجات تقليدية وحرفية": "المنتجات التقليدية والحرفية",
  "حيوانات أليفة": "مستلزمات الحيوانات الأليفة",
};

const STR = {
  ar: {
    tagline: "دليل تجارة الجملة",
    catalogTitle: "Jemlix — دليل تجارة الجملة",
    catalogDescription: "Jemlix — دليل تجارة الجملة: الأسعار، الحد الأدنى للطلب، والتواصل المباشر مع المورّد.",
    aboutTitle: "Jemlix — من نحن",
    aboutDescription: "تعرّف على Jemlix: نحوّل محتوى تيليغرام إلى متجر جملة منظم وسهل التحديث.",
    blogTitle: "Jemlix — المدونة",
    blogDescription: "مدونة Jemlix: نصائح عملية لتنظيم كتالوج الجملة وإدارته انطلاقاً من تيليغرام.",
    search: "البحث في الدليل",
    allCats: "كل المنتجات",
    allCategories: "جميع الفئات",
    menu: "القائمة",
    categoriesTitle: "تصفّح جميع الفئات",
    close: "إغلاق",
    empty: "لا توجد منتجات حالياً",
    loadError: "تعذر تحميل الدليل",
    storeSub: "متجر جملة",
    contact: "تواصل مع البائع",
    backToCatalog: "الدليل ←",
    backToStores: "جميع المتاجر ←",
    moq: "الحد الأدنى",
    stock: "المخزون",
    specs: "المواصفات",
    desc: "الوصف",
    contactWa: "تواصل عبر واتساب",
    contactTg: "تواصل عبر تيليغرام",
    stores: "المتاجر",
    priceOnRequest: "السعر عند الطلب",
    notFound: "هذا المنتج غير موجود.",
    about: "من نحن",
    blog: "المدونة",
    footerPitch: "نحوّل محتوى مورّدي تيليغرام إلى متاجر جملة منظمة، ونساعدهم على إبقاء القناة والدليل متزامنين.",
    footerTag: "Telegram → Catalogue",
    footerExplore: "اكتشف",
    footerCatalog: "دليل الجملة",
    footerStores: "متاجر الموردين",
    footerForSuppliers: "للموردين",
    language: "اللغة",
    footerService: "كيف تعمل الخدمة",
    footerAccess: "دخول إدارة المنتجات",
    footerLegal: "Jemlix وسيط لعرض المنتجات. يتم الطلب والدفع مباشرة مع المورّد.",
    currency: "د.م",
  },
  fr: {
    tagline: "Catalogue de gros",
    catalogTitle: "Jemlix — Catalogue de gros",
    catalogDescription: "Jemlix — catalogue de gros avec prix, minimum de commande et contact direct avec le fournisseur.",
    aboutTitle: "Jemlix — À propos",
    aboutDescription: "Découvrez Jemlix : nous transformons le contenu Telegram en boutique de gros structurée et facile à maintenir.",
    blogTitle: "Jemlix — Blog",
    blogDescription: "Le blog Jemlix : conseils pratiques pour structurer et maintenir un catalogue de gros depuis Telegram.",
    search: "Rechercher dans le catalogue",
    allCats: "Tous les produits",
    allCategories: "Toutes les catégories",
    menu: "Menu",
    categoriesTitle: "Parcourir toutes les catégories",
    close: "Fermer",
    empty: "Aucun produit pour le moment",
    loadError: "Impossible de charger le catalogue",
    storeSub: "Boutique de gros",
    contact: "Contacter le vendeur",
    backToCatalog: "← Catalogue",
    backToStores: "← Toutes les boutiques",
    moq: "Min. commande",
    stock: "Stock",
    specs: "Caractéristiques",
    desc: "Description",
    contactWa: "Contacter via WhatsApp",
    contactTg: "Contacter via Telegram",
    stores: "Boutiques",
    priceOnRequest: "Prix sur demande",
    notFound: "Produit introuvable.",
    about: "À propos",
    blog: "Blog",
    footerPitch: "Nous transformons le catalogue Telegram d’un fournisseur en boutique de gros structurée, puis aidons à garder les deux synchronisés.",
    footerTag: "Telegram → Catalogue",
    footerExplore: "Découvrir",
    footerCatalog: "Catalogue de gros",
    footerStores: "Boutiques fournisseurs",
    footerForSuppliers: "Pour les fournisseurs",
    language: "Langue",
    footerService: "Comment fonctionne le service",
    footerAccess: "Gérer mes produits",
    footerLegal: "Jemlix est un intermédiaire de catalogue. Commande et paiement se font directement avec le fournisseur.",
    currency: "MAD",
  },
};

const LS_KEY = "jemla-lang";

let lang = (() => {
  try {
    return localStorage.getItem(LS_KEY) === "fr" ? "fr" : "ar";
  } catch {
    return "ar";
  }
})();

export function getLang() {
  return lang;
}

export function setLang(next) {
  lang = next === "fr" ? "fr" : "ar";
  try {
    localStorage.setItem(LS_KEY, lang);
  } catch {
    /* ignore */
  }
  applyDir();
  translatePage();
  document.dispatchEvent(new CustomEvent("jemla:lang"));
}

export function t(key) {
  return STR[lang]?.[key] ?? STR.ar[key] ?? key;
}

export function catLabel(name) {
  if (lang === "fr" && CATEGORIES[name]) return CATEGORIES[name];
  return AR_CATEGORIES[name] || name;
}

export function countLabel(n) {
  return lang === "fr" ? `${n} produit${n > 1 ? "s" : ""}` : `${n} منتج`;
}

export function moqLabel(m) {
  return lang === "fr" ? `Min. commande : ${m}` : `الحد الأدنى: ${m}`;
}

function applyDir() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
}

export function translatePage() {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll("[data-i18n-ph]")) {
    el.placeholder = t(el.dataset.i18nPh);
  }
  for (const el of document.querySelectorAll("[data-i18n-aria]")) {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  }
}

export function initLang() {
  applyDir();
  translatePage();
  const sync = () => {
    for (const btn of document.querySelectorAll("[data-lang]")) {
      btn.setAttribute("aria-pressed", btn.dataset.lang === lang ? "true" : "false");
    }
  };
  for (const btn of document.querySelectorAll("[data-lang]")) {
    btn.addEventListener("click", () => setLang(btn.dataset.lang));
  }
  document.addEventListener("jemla:lang", sync);
  sync();

  const menuButton = document.querySelector(".menu-toggle");
  const menu = document.getElementById("site-nav");
  if (menuButton && menu) {
    const closeMenu = () => menuButton.setAttribute("aria-expanded", "false");
    menuButton.addEventListener("click", () => {
      menuButton.setAttribute("aria-expanded", String(menuButton.getAttribute("aria-expanded") !== "true"));
    });
    document.addEventListener("click", (event) => {
      if (!menuButton.contains(event.target) && !menu.contains(event.target)) closeMenu();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });
  }
}
