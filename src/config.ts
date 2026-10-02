export const config = {
  host: Bun.env.HOST ?? "127.0.0.1",
  port: Number(Bun.env.PORT ?? 3001),

  // Empty = admin open (dev only). Set in .env for anything public.
  adminToken: Bun.env.ADMIN_TOKEN ?? "",

  defaultWhatsapp: Bun.env.DEFAULT_WHATSAPP ?? "",
  defaultChannel: Bun.env.DEFAULT_CHANNEL ?? "",

  // WORKFLOW.md Phase 2: Telegram bot. Empty = bot disabled.
  botToken: Bun.env.BOT_TOKEN ?? "",
  // Telegram user id of the catalog owner (for "new supplier / new submission" notices).
  adminChatId: Bun.env.ADMIN_CHAT_ID ?? "",

  // Public origin used in bot messages, e.g. https://jemlix.com (no trailing slash).
  publicBaseUrl: (Bun.env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, ""),
  // Optional separate key for hashing supplier login codes/sessions. When empty,
  // BOT_TOKEN (then ADMIN_TOKEN) is used so existing installs keep working.
  supplierAuthSecret: Bun.env.SUPPLIER_AUTH_SECRET ?? "",

  categories: [
    "ملابس رجال", "ملابس نساء", "ملابس أطفال",
    "أحذية", "حقائب", "ساعات ونظارات", "اكسسوارات",
    "كوزمتيك وتجميل", "عطور", "صحة وعناية",
    "إلكترونيات", "هواتف وإكسسوارات", "حواسيب ومستلزمات المكتب", "أجهزة منزلية",
    "مطبخ وأواني", "أثاث وديكور", "لوازم الأم والطفل", "لعب أطفال",
    "مواد غذائية", "مشروبات", "تنظيف", "مكتبة ولوازم مدرسية",
    "تغليف ومستلزمات المتاجر", "أدوات ومعدات", "معدات مهنية وصناعية",
    "سيارات وقطع غيار", "مواد بناء", "حديقة وفلاحة", "رياضة",
    "أقمشة ونسيج", "منتجات تقليدية وحرفية", "حيوانات أليفة", "أخرى",
  ],
};
