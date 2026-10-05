// WORKFLOW.md Phase 2 — Telegram bot: supplier onboarding + product intake.
// Runs in the same Bun process as src/index.ts. Disabled when BOT_TOKEN is empty.
import { Bot, InputFile } from "grammy";
import db from "./db.ts";
import { config } from "./config.ts";
import { ensureThumbs } from "./thumbs.ts";
import { normalizeWhatsapp, whatsappOk } from "./suppliers.ts";
import { isValidSlug } from "./slug.ts";
import { createSupplierLoginCode, revokeAllSupplierSessions } from "./supplier-auth.ts";

let bot: Bot | null = null;
let started = false;

const BOT_COMMANDS = [
  { command: "start", description: "بدء التسجيل وربط المتجر" },
  { command: "code", description: "إنشاء رمز دخول لإدارة المنتجات" },
  { command: "mystore", description: "معلومات المتجر والحالة" },
  { command: "mylink", description: "رابط المتجر" },
  { command: "logoutall", description: "تسجيل الخروج من جميع الأجهزة" },
  { command: "help", description: "عرض المساعدة" },
];

// In-memory onboarding: telegram_id -> step.
const onboarding = new Map<number, { step: "name" | "whatsapp" }>();

type Supplier = {
  id: number;
  telegram_id: number | null;
  name: string;
  username: string;
  whatsapp: string;
  channel_id: string;
  channel_title: string;
  channel_slug: string;
  status: string;
  onboarding_step: string;
};

function getSupplierByTg(tgId: number): Supplier | null {
  return (db.query(`SELECT * FROM suppliers WHERE telegram_id = ?`).get(tgId) as Supplier | null) ?? null;
}

function setStep(tgId: number, step: string): void {
  onboarding.set(tgId, { step: step as "name" | "whatsapp" });
  db.query(`UPDATE suppliers SET onboarding_step = ? WHERE telegram_id = ?`).run(step, tgId);
}

function clearStep(tgId: number): void {
  onboarding.delete(tgId);
  db.query(`UPDATE suppliers SET onboarding_step = '' WHERE telegram_id = ?`).run(tgId);
}

function auditSupplierEvent(supplierId: number, eventType: string, details: unknown): void {
  db.query(`INSERT INTO supplier_events (supplier_id, event_type, actor, details) VALUES (?,?, 'supplier', ?)`)
    .run(supplierId, eventType, JSON.stringify(details));
}

// Restart-safe: the DB step survives restarts, the Map does not.
function currentStep(tgId: number): "name" | "whatsapp" | null {
  const mem = onboarding.get(tgId)?.step;
  if (mem) return mem;
  const row = getSupplierByTg(tgId);
  if (row?.onboarding_step === "name" || row?.onboarding_step === "whatsapp") {
    onboarding.set(tgId, { step: row.onboarding_step });
    return row.onboarding_step;
  }
  return null;
}

function ensureStoreChannel(slug: string, name: string): void {
  if (!slug) return;
  const bySlug = db.query(`SELECT slug FROM channels WHERE slug = ?`).get(slug);
  if (bySlug) return;
  const label = (name || "").trim() || slug;
  const byName = db.query(`SELECT slug FROM channels WHERE name = ?`).get(label);
  if (byName) {
    db.query(`UPDATE channels SET slug = ? WHERE name = ?`).run(slug, label);
    return;
  }
  db.query(`INSERT INTO channels (name, slug) VALUES (?, ?)`).run(label, slug);
}

function storeLink(s: Supplier): string {
  return s.channel_slug ? `/c/${s.channel_slug}` : "مازال ما تحددش (غادي يحددو الأدمن)";
}

// Full https URL for messages to suppliers (relative paths are not tappable in Telegram).
export function storeUrl(s: Supplier): string {
  if (!s.channel_slug || !config.publicBaseUrl) return "";
  return `${config.publicBaseUrl}/c/${s.channel_slug}`;
}

async function savePhotoFile(tgId: number, supplierId: number, msgId: number, getFile: () => Promise<{ file_path?: string }>): Promise<string | null> {
  try {
    const f = await getFile();
    if (!f.file_path) return null;
    const url = `https://api.telegram.org/file/bot${config.botToken}/${f.file_path}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const name = `${Date.now()}_${supplierId}_${msgId}.jpg`;
    await Bun.write(`media/${name}`, buf);
    await ensureThumbs([name]);
    return name;
  } catch {
    return null;
  }
}

export async function notifyAdmin(text: string): Promise<void> {
  if (!config.botToken || !config.adminChatId) return;
  try {
    const b = bot ?? new Bot(config.botToken);
    await b.api.sendMessage(config.adminChatId, text);
  } catch {
    // notifications never break the web flow
  }
}

export async function notifySupplier(telegramId: number, text: string): Promise<void> {
  if (!config.botToken || !telegramId) return;
  try {
    const b = bot ?? new Bot(config.botToken);
    await b.api.sendMessage(telegramId, text);
  } catch {
    // supplier may have blocked the bot; ignore
  }
}

// One product = one message: all its photos selected together + caption.
// This block is repeated wherever the supplier needs the rule reminded.
const HOW_TO_SEND =
  "باش تصيفط منتج: اختار التصاور كاملين فرسالة وحدة (تحديد متعدد) وزيد الوصف مع الثمن. كل رسالة = منتج واحد.";

function snippet(text: string): string {
  const line = String(text || "").split("\n").map((s) => s.trim()).filter(Boolean)[0] || "";
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}

// Confirmation so the supplier sees exactly what was captured as ONE product.
function intakeReply(imageCount: number, caption: string, delivery: "posted" | "failed", singleTip: boolean): string {
  const photos = imageCount === 1 ? "تصويرة وحدة" : imageCount === 0 ? "الرسالة" : `${imageCount} تصاور`;
  const desc = snippet(caption) || "—";
  const lines = [
    `توصّلنا بـ ${photos} ✅`,
    `الوصف: ${desc}`,
    "تسجلات كمنتج واحد، غتراجع قبل ما يبان فالكاتالوغ.",
    delivery === "posted" ? "تنشرات فقناتك." : "ولكن ما قدرناش ننشروها فقناتك — رد البوت أدمن فالقناة.",
  ];
  if (singleTip) lines.push("ملاحظة: باش تزيد تصاور لنفس المنتج، صيفطهم مجموعين فرسالة وحدة.");
  return lines.join("\n");
}
const albums = new Map<string, { supplierId: number; caption: string; images: string[]; msgIds: number[]; timer: ReturnType<typeof setTimeout> }>();
const ALBUM_WAIT_MS = 2500;

const insertSubmission = db.query(
  `INSERT OR IGNORE INTO submissions (supplier_id, tg_message_id, text, image, images, media_group_id, status) VALUES (?,?,?,?,?,?, 'new')`,
);

function saveSubmission(supplierId: number, tgMsgId: number | null, text: string, images: string[], mediaGroupId: string | null): number {
  const info = insertSubmission.run(supplierId, tgMsgId, text.slice(0, 4000), images[0] ?? null, JSON.stringify(images), mediaGroupId);
  return Number(info.lastInsertRowid) || 0; // 0 = duplicate delivery, ignored
}

async function postToChannel(api: any, channelId: string, text: string, images: string[]): Promise<"posted" | "failed"> {
  try {
    if (images.length > 1) {
      await api.sendMediaGroup(
        channelId,
        images.map((f, i) => ({
          type: "photo" as const,
          media: new InputFile(`media/${f}`),
          ...(i === 0 && text ? { caption: text.slice(0, 1024) } : {}),
        })),
      );
    } else if (images.length === 1) {
      await api.sendPhoto(channelId, new InputFile(`media/${images[0]}`), { caption: text.slice(0, 1024) || undefined });
    } else if (text) {
      await api.sendMessage(channelId, text.slice(0, 4000));
    }
    return "posted";
  } catch {
    return "failed"; // usually: bot is no longer a channel admin
  }
}

function flushAlbum(ctx: any, groupId: string): void {
  const album = albums.get(groupId);
  if (!album) return;
  albums.delete(groupId);
  void (async () => {
    const subId = saveSubmission(album.supplierId, Math.min(...album.msgIds), album.caption, album.images, groupId);
    if (!subId) return; // duplicate album delivery
    const supplier = db.query(`SELECT * FROM suppliers WHERE id = ?`).get(album.supplierId) as Supplier;
    const delivery = supplier?.channel_id ? await postToChannel(ctx.api, supplier.channel_id, album.caption, album.images) : "failed";
    db.query(`UPDATE submissions SET delivery = ? WHERE id = ?`).run(delivery, subId);
    await notifyAdmin(`New submission #${subId} from ${supplier?.name || album.supplierId} (${album.images.length} photos, ${delivery === "posted" ? "posted to channel" : "NOT posted to channel"}) — review in Submissions`);
    await ctx.reply(intakeReply(album.images.length, album.caption, delivery, false));
  })().catch(() => {});
}

export function startBot(): Bot | null {
  if (!config.botToken || started) return bot;
  started = true;
  bot = new Bot(config.botToken);

  bot.command("start", async (ctx) => {
    const tgId = ctx.from?.id;
    if (!tgId) return;
    const existing = getSupplierByTg(tgId);
    if (existing?.status === "active") {
      await ctx.reply(`مرحبا ${existing.name || ""} — متجرك: ${storeUrl(existing) || storeLink(existing)}\n/code للدخول لإدارة المنتجات · /help`);
      return;
    }
    if (existing) {
      // Resume an interrupted onboarding from the DB step.
      if (!existing.name) {
        setStep(tgId, "name");
        await ctx.reply("مرحبا بك فـ Jemlix — شنو سميتك (أو سمية المحل)؟");
        return;
      }
      if (!existing.whatsapp) {
        setStep(tgId, "whatsapp");
        await ctx.reply(`مرحبا ${existing.name} — كمل التسجيل: صيفط رقم الواتساب (مثلا: 0612345678)`);
        return;
      }
      if (!existing.channel_id) {
        await ctx.reply("تسجيلك قريب يكمل — زيد البوت مدير (admin) فالقناة ديالك باش نربطوها");
        return;
      }
      await ctx.reply(`حسابك قيد المراجعة (${existing.status}). ملي يتفعل غيوصلك خبر.`);
      return;
    }
    onboarding.set(tgId, { step: "name" });
    await ctx.reply("مرحبا بك فـ Jemlix — شنو سميتك (أو سمية المحل)؟");
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      [HOW_TO_SEND, "", "/code — كود الدخول لإدارة جميع المنتجات", "/logoutall — خرج جميع الأجهزة", "/mystore — معلومات المتجر والرابط", "/mylink — رابط المتجر", "/setname <الاسم> — تغيير الاسم", "/setphone <الرقم> — تغيير واتساب", "/setslug <slug> — طلب سيلغ جديد"].join("\n"),
    );
  });

  // Useful during the first deployment to discover ADMIN_CHAT_ID without
  // sharing the bot token with a third-party ID bot.
  bot.command("id", async (ctx) => {
    if (ctx.from?.id) await ctx.reply(`Telegram ID: <code>${ctx.from.id}</code>`, { parse_mode: "HTML" });
  });

  async function sendManagementCode(ctx: any): Promise<void> {
    const tgId = ctx.from?.id;
    if (!tgId) return;
    const supplier = getSupplierByTg(tgId);
    if (!supplier) {
      await ctx.reply("مازال ما مسجلش — صيفط /start");
      return;
    }
    if (supplier.status !== "active") {
      await ctx.reply("الحساب ديالك مازال ما تفعلش. ملي يتفعل تقدر تولّد كود الدخول.");
      return;
    }
    if (!config.publicBaseUrl) {
      await ctx.reply("رابط إدارة المنتجات مازال ما تجهزش — تاصل بالأدمن");
      await notifyAdmin("PUBLIC_BASE_URL missing: supplier could not generate a product-manage link");
      return;
    }
    try {
      const code = createSupplierLoginCode(supplier);
      await ctx.reply(
        `كود الدخول: <code>${code}</code>\n\nصالح لمدة 10 دقايق ولمرة وحدة. دخلو هنا:\n${config.publicBaseUrl}/supplier`,
        { parse_mode: "HTML" },
      );
    } catch {
      await ctx.reply("ما قدرناش نولّدو الكود دابا — عاود من بعد");
    }
  }

  bot.command("code", sendManagementCode);
  bot.command("generatecode", sendManagementCode);

  bot.command("logoutall", async (ctx) => {
    const supplier = ctx.from?.id ? getSupplierByTg(ctx.from.id) : null;
    if (!supplier) {
      await ctx.reply("مازال ما مسجلش — صيفط /start");
      return;
    }
    revokeAllSupplierSessions(supplier.id);
    await ctx.reply("تسدّ الدخول من جميع الأجهزة. ملي تحتاج تدخل عاود صيفط /code");
  });

  bot.command("mystore", async (ctx) => {
    const s = ctx.from?.id ? getSupplierByTg(ctx.from.id) : null;
    if (!s) {
      await ctx.reply("مازال ما مسجلش — صيفط /start");
      return;
    }
    await ctx.reply(`المتجر: ${s.channel_title || "—"}\nالرابط: ${storeUrl(s) || storeLink(s)}\nالحالة: ${s.status}\nواتساب: ${s.whatsapp || "—"}`);
  });

  bot.command("mylink", async (ctx) => {
    const s = ctx.from?.id ? getSupplierByTg(ctx.from.id) : null;
    if (!s) {
      await ctx.reply("مازال ما مسجلش — صيفط /start");
      return;
    }
    await ctx.reply(storeUrl(s) || storeLink(s));
  });

  bot.command("myproducts", async (ctx) => {
    const tgId = ctx.from?.id;
    if (!tgId) return;
    const s = getSupplierByTg(tgId);
    if (!s) {
      await ctx.reply("مازال ما مسجلش — صيفط /start");
      return;
    }
    await ctx.reply("باش تشوف وتقلب فجميع المنتجات ديالك صيفط /code ودخل للوحة الإدارة");
  });

  // Old command-based editing is kept as a friendly redirect. Suppliers do
  // not need to remember product ids or command syntax anymore.
  for (const command of ["edit", "hide", "show"]) {
    bot.command(command, async (ctx) => {
      await ctx.reply("التعديل ولى ساهل فلوحة المنتجات — صيفط /code وخذ كود الدخول");
    });
  }

  bot.command("setname", async (ctx) => {
    const tgId = ctx.from?.id;
    const value = (ctx.message?.text ?? "").replace(/^\/setname\s*/, "").trim().slice(0, 120);
    if (!tgId || !value) {
      await ctx.reply("مثال: /setname محل سعيد");
      return;
    }
    db.query(`UPDATE suppliers SET name = ? WHERE telegram_id = ?`).run(value, tgId);
    await ctx.reply("تم");
  });

  bot.command("setphone", async (ctx) => {
    const tgId = ctx.from?.id;
    const value = (ctx.message?.text ?? "").replace(/^\/setphone\s*/, "").trim();
    if (!tgId || !value) {
      await ctx.reply("مثال: /setphone 0612345678");
      return;
    }
    const norm = normalizeWhatsapp(value);
    if (!whatsappOk(norm)) {
      await ctx.reply("الرقم غير صالح");
      return;
    }
    db.query(`UPDATE suppliers SET whatsapp = ? WHERE telegram_id = ?`).run(norm, tgId);
    await ctx.reply("تم");
  });

  bot.command("setslug", async (ctx) => {
    const tgId = ctx.from?.id;
    const value = (ctx.message?.text ?? "").replace(/^\/setslug\s*/, "").trim().toLowerCase();
    if (!tgId || !value || !isValidSlug(value)) {
      await ctx.reply("مثال: /setslug said-shop");
      return;
    }
    const s = getSupplierByTg(tgId);
    if (!s) {
      await ctx.reply("مازال ما مسجلش — صيفط /start");
      return;
    }
    const taken = db.query(`SELECT id FROM suppliers WHERE channel_slug = ? AND id != ?`).get(value, s.id);
    if (taken) {
      await ctx.reply("هاد السيلغ مستعمل");
      return;
    }
    db.query(`UPDATE suppliers SET channel_slug = ? WHERE id = ?`).run(value, s.id);
    ensureStoreChannel(value, s.channel_title || s.name);
    await notifyAdmin(`New slug request from ${s.name || tgId}: /c/${value}`);
    await ctx.reply(`طلبك تسجل: ${config.publicBaseUrl ? `${config.publicBaseUrl}/c/${value}` : `/c/${value}`} — الأدمن غادي يراجعو`);
  });

  // A channel is confirmed only when the same Telegram account that onboarded
  // the supplier promotes the bot to administrator in that channel.
  bot.on("my_chat_member", async (ctx) => {
    try {
      const update = ctx.myChatMember;
      const chat = update?.chat;
      const fromId = update?.from?.id;
      const newStatus = (update as any)?.new_chat_member?.status;
      if (!chat || chat.type !== "channel" || !fromId) return;
      if (newStatus !== "administrator") return;
      const s = getSupplierByTg(fromId);
      const channelId = String(chat.id);
      const title = (chat as any).title ?? "";
      if (s) {
        const claimed = db.query(`SELECT id, name FROM suppliers WHERE channel_id = ? AND id != ? LIMIT 1`).get(channelId, s.id) as any;
        if (claimed) {
          await notifyAdmin(`Channel ${title} link attempt for supplier ${s.name || fromId}, but it is already linked to ${claimed.name || `#${claimed.id}`}`);
          await notifySupplier(fromId, "هاد القناة مربوطة من قبل بحساب آخر. تاصل بإدارة Jemlix باش نراجعوها.");
          return;
        }
        if (s.channel_id && s.channel_id !== channelId) {
          await notifyAdmin(`Supplier ${s.name || fromId} tried to link a second channel: ${title}. Current channel: ${s.channel_title || s.channel_id}`);
          await notifySupplier(fromId, "الحساب ديالك مربوط دابا بقناة أخرى. تغيير القناة خاصو مراجعة من إدارة Jemlix.");
          return;
        }
        db.query(`UPDATE suppliers SET channel_id = ?, channel_title = ? WHERE id = ?`).run(channelId, title, s.id);
        auditSupplierEvent(s.id, "channel_linked", { channel_id: channelId, channel_title: title, confirmed_by_telegram_id: fromId });
        await notifyAdmin(`Supplier ${s.name || fromId} linked channel: ${title}`);
        await notifySupplier(fromId, `تربطات القناة ${title} ✅\n${HOW_TO_SEND}`);
      } else {
        await notifyAdmin(`Bot added to channel ${title} by ${fromId} with no registered supplier`);
      }
    } catch {
      // ignore
    }
  });

  // Onboarding answers + product intake (photo or text) from linked suppliers.
  bot.on("message", async (ctx) => {
    const tgId = ctx.from?.id;
    if (!tgId || ctx.message?.text?.startsWith("/")) return;

    // 1. Onboarding steps (DB-backed so a restart resumes).
    const step = currentStep(tgId);
    if (step) {
      const answer = (ctx.message as any)?.text?.trim() ?? "";
      if (!answer) {
        await ctx.reply("صيفط الجواب نصا");
        return;
      }
      if (step === "name") {
        const username = ctx.from?.username ?? "";
        db.query(`INSERT INTO suppliers (telegram_id, name, username, status, onboarding_step) VALUES (?,?,?, 'pending', 'whatsapp') ON CONFLICT(telegram_id) DO UPDATE SET name = excluded.name, onboarding_step = 'whatsapp'`).run(
          tgId,
          answer.slice(0, 120),
          username,
        );
        onboarding.set(tgId, { step: "whatsapp" });
        await ctx.reply("مزيان — دابا صيفط رقم الواتساب (مثلا: 0612345678)");
        return;
      }
      const norm = normalizeWhatsapp(answer);
      if (!whatsappOk(norm)) {
        await ctx.reply("الرقم غير صالح — عاود (مثلا: 0612345678)");
        return;
      }
      db.query(`UPDATE suppliers SET whatsapp = ?, onboarding_step = '' WHERE telegram_id = ?`).run(norm, tgId);
      clearStep(tgId);
      const s = getSupplierByTg(tgId);
      await notifyAdmin(`New supplier pending review: ${s?.name || tgId} (${norm})`);
      await ctx.reply(`تسجلتي — دابا زيد البوت مدير (admin) فالقناة ديالك باش نربطوها.\n\n${HOW_TO_SEND}`);
      return;
    }

    const msg: any = ctx.message;

    // 3. Product intake from a linked supplier (albums grouped, duplicates ignored).
    const supplier = getSupplierByTg(tgId);
    if (!supplier || !supplier.channel_id) return; // not ours to handle
    const caption: string = msg?.caption ?? msg?.text ?? "";
    const photos = msg?.photo;
    if (!photos && !caption) return;
    let image: string | null = null;
    if (photos?.length) {
      image = await savePhotoFile(tgId, supplier.id, msg.message_id, () => ctx.getFile());
      if (!image && !caption) {
        await ctx.reply("تعذر تحميل التصويرة — عاود صيفطها");
        return;
      }
    }
    const groupId: string | null = msg?.media_group_id ?? null;
    if (groupId && image) {
      // Album: buffer photos, flush one submission after the burst settles.
      const pending = albums.get(groupId);
      if (pending) {
        clearTimeout(pending.timer);
        pending.images.push(image);
        pending.msgIds.push(msg.message_id);
        if (caption && !pending.caption) pending.caption = caption;
        pending.timer = setTimeout(() => flushAlbum(ctx, groupId), ALBUM_WAIT_MS);
      } else {
        albums.set(groupId, {
          supplierId: supplier.id,
          caption,
          images: [image],
          msgIds: [msg.message_id],
          timer: setTimeout(() => flushAlbum(ctx, groupId), ALBUM_WAIT_MS),
        });
      }
      return;
    }
    const subId = saveSubmission(supplier.id, msg.message_id, caption, image ? [image] : [], null);
    if (!subId) {
      await ctx.reply("هاد المنتج توصلنا به من قبل");
      return;
    }
    const delivery = await postToChannel(ctx.api, supplier.channel_id, caption, image ? [image] : []);
    db.query(`UPDATE submissions SET delivery = ? WHERE id = ?`).run(delivery, subId);
    await notifyAdmin(`New submission #${subId} from ${supplier.name || tgId} (${delivery === "posted" ? "posted to channel" : "NOT posted to channel"}) — review in Submissions`);
    await ctx.reply(intakeReply(image ? 1 : 0, caption, delivery, !!image));
  });

  void bot.api.setMyCommands(BOT_COMMANDS).catch((err) => {
    console.error("bot command menu failed:", err instanceof Error ? err.message : String(err));
  });
  bot.catch((err) => {
    const cause = (err as any)?.error;
    console.error(
      `bot update ${(err as any)?.ctx?.update?.update_id ?? "unknown"} failed:`,
      cause instanceof Error ? cause.message : String(cause || "unknown error"),
    );
  });
  bot.start().catch((err) => {
    console.error("bot polling stopped:", err instanceof Error ? err.message : String(err));
    // The website and bot share one service. Let systemd restart both if
    // polling fails fatally instead of leaving a silently dead bot online.
    process.exitCode = 1;
    process.kill(process.pid, "SIGTERM");
  });
  console.log("   🤖 Bot polling started");
  return bot;
}

export async function stopBot(): Promise<void> {
  if (!bot || !started) return;
  try {
    await bot.stop();
  } catch (err) {
    console.error("bot shutdown warning:", err instanceof Error ? err.message : String(err));
  } finally {
    bot = null;
    started = false;
  }
}
