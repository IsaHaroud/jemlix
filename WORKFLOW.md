# Jemlix — Supplier & Product Workflow

Status: Live and operational (September / October 2026). Single Bun process running website, admin dashboard, supplier portal, and Telegram polling bot.

---

## 1. The Jemlix Principle ("Zero Behavior Change")

Moroccan wholesale suppliers (*grossistes* / تجار الجملة) in hubs like Derb Omar, Casablanca, or Inezgane rely on Telegram and WhatsApp. They will not adopt complex dashboards, remember passwords, or upload inventory twice.

The core value proposition:
> **"Keep posting in your Telegram channel exactly like you do today. Jemlix turns your channel into an organized, searchable web store link (`jemlix.com/c/<slug>`) that sells while you sleep, and syncs all your new posts automatically."**

- **Zero friction:** The supplier's channel remains theirs, their audience remains theirs.
- **Archive monetization:** Products that get buried in chat scroll become permanently searchable by category, price, and MOQ.
- **Direct contact:** Wholesale buyers order directly via WhatsApp or Telegram; Jemlix does not hold inventory or touch buyer payments.

---

## 2. Actors & System Roles

| Actor | Channel / Interface | Role & Responsibilities |
| :--- | :--- | :--- |
| **Supplier** | Telegram Bot (`@JemlixBot`) + Mobile Browser (`/supplier`) | Owns wholesale channel. Sends products to bot in DM. Edits prices/stock via passwordless code. |
| **Bot** | Telegram Bot API (`src/bot.ts`) | Admin of each supplier's channel. Immediate channel re-publisher, submission collector, and supplier notifier. |
| **Admin (You)** | Jemlix Admin Dashboard (`/admin`) | Moderates incoming submissions, curates product listings, sets store slugs, manages CRM billing & offline payments. |
| **Buyer** | Public Catalog (`/` and `/c/<slug>`) | Retailers, drop-shippers, and boutique owners. Searches products, views wholesale tiers/MOQ, contacts supplier directly. |

---

## 3. High-Level Lifecycle Map

```
┌────────────────────────────────────────────────────────────────────────┐
│                          OVERALL LIFECYCLE                             │
└────────────────────────────────────────────────────────────────────────┘

 1. Pitch & Offer ──► 2. Bot Onboarding ──► 3. Telegram Desktop Export 
                                                         │
 6. Supplier Portal ◄── 5. Ongoing Sync ◄── 4. Import & Curation
     (/code web)         (DM Bot ─► Channel)     (Admin Queue ─► Live Store)
```

---

## 4. End-to-End Operational Flows

### Flow A: Pitch, Pricing & Commercial Agreement (The "Heavy Work" Setup)

1. **Offer Structures:**
   * **Pilot / Trial:** First 60–100 products structured for free, 14-day trial period.
   * **Catalog Build (Heavy Work):** Upfront per-product estimate (e.g., 200 products estimated × 2 MAD = 400 MAD build fee).
   * **Ongoing Maintenance:** Proposed ~99 MAD/month (covers hosting, bot sync, catalog updates, and view analytics).
2. **Upfront Payment Recording in Admin CRM:**
   * Open **Admin (`/admin`) → Suppliers → Open Supplier Drawer**.
   * Under **Catalog build (onboarding)**, record the upfront estimate before a subscription plan even exists.
   * Payments are classified as `onboarding` vs. `subscription` so one-time build fees never distort recurring subscription period dates. Supported payment methods: `cash`, `bank`, `wafacash`, `cmi`, `other`.

---

### Flow B: Supplier Onboarding & Channel Linking

The supplier links their store identity without creating passwords or entering credentials:

```
Supplier                  Telegram Bot (@JemlixBot)              Admin Dashboard
   │                                  │                                │
   ├────────── /start ───────────────►│                                │
   │◄── "شنو سميتك؟" ─────────────────┤                                │
   ├───── Shop Name (e.g. محل سعيد) ──►│ (Saves pending supplier)       │
   │◄── "صيفط رقم الواتساب" ──────────┤                                │
   ├───── WhatsApp (0612345678) ─────►│                                │
   │                                  ├──── Admin Notification ───────►│ ("New supplier pending...")
   │◄── "أضفني مديرا فالقناة ديالك" ──┤                                │
   │    (Add bot as channel admin)    │                                │
   │                                  │                                │
   ▼ (Promotes Bot in Channel)        │                                │
[Telegram: my_chat_member] ──────────►│ (Matches user ID,              │
                                      │  locks channel_id)             │
                                      ├──── Admin Notification ───────►│ ("Linked channel: ...")
                                      │                                │
                                      │                          Admin activates
                                      │                          supplier & sets slug
                                      │◄─── Store live notification ───┤
   │◄── "تربطات القناة ✅" ───────────┤                                │
```

* **Security Mechanism:** A bot cannot read a Telegram channel, but it **can post** to a channel it administers.
* Channel linking is strictly validated against `my_chat_member.from.id`. The Telegram user who registered must be the one promoting the bot.
* A channel already claimed by another supplier cannot be linked.
* If onboarding is interrupted, the step survives server restarts in the database (`onboarding_step`) and resumes on their next message.

---

### Flow C: The "Heavy Work" (Telegram Desktop Export & Server CLI Import)

Because the bot was not in the channel in the past, existing channel history must be imported in bulk:

1. **Export from Telegram Desktop:**
   * Open Telegram Desktop on your computer.
   * Go to the supplier's channel → `⋮` (Menu) → **Export Chat History**.
   * Uncheck videos/files; select **Photos** only.
   * Set format to **JSON** (`result.json`).
2. **Transfer to Server / VPS:**
   ```bash
   rsync -az --partial --progress \
     /local/path/ChatExport/ \
     root@jemlix.com:/var/lib/jemla-imports/supplier-12/
   ```
3. **Execute CLI Importer (`src/import.ts`):**
   * Inspect message counts and photos with a dry run:
     ```bash
     sudo -iu jemla bash -lc 'cd /opt/jemla && bun run import:dry -- /var/lib/jemla-imports/supplier-12 --supplier 12'
     ```
   * Run the production import:
     ```bash
     sudo -iu jemla bash -lc 'cd /opt/jemla && bun run import -- /var/lib/jemla-imports/supplier-12 --supplier 12'
     ```
4. **Automated Pipeline during Import:**
   * Generates optimized 480px WebP/JPEG thumbnails into `media/thumbs/` for instant mobile browsing.
   * Extracts Moroccan phone numbers (`+212...` / `06...`) from post captions via regex.
   * Performs an idempotent upsert on `(channel, msg_id)`: re-importing the same channel will refresh photos and text without reverting curated posts back to `new` or unlinking live products.

---

### Flow D: Admin Curation & Balance Reconciliation

1. **Curate in Admin Queue (`/admin` → Queue):**
   * Filter posts by the supplier's channel.
   * Select one or more posts representing a single product (multi-photo grouping).
   * Click **"Build product"** (`كوّن منتج`):
     * Clean the title (strip emoji spam).
     * Set Category, MOQ (Minimum Order Quantity), Wholesale Price (or "Price on request" / wholesale volume tiers), and Stock status.
     * Click **Publish** (or Save Draft).
2. **Reconcile Build Balance:**
   * Open **Admin → Suppliers → Supplier Drawer**.
   * The **Catalog build (onboarding)** panel displays live math:
     $$\text{Exact} = \text{Published Products} \times \text{Rate (MAD)}$$
   * Compares `Exact` against `Paid`. If estimated 400 MAD was paid and 180 products were published at 2 MAD (360 MAD), it shows settled with clear accounting. If extra is due, record the remaining balance with one click.

---

### Flow E: Day-to-Day Product Intake (The Ongoing Sync Loop)

Once onboarded, the supplier never needs to use an admin dashboard to publish new inventory:

```
Supplier                          Telegram Bot                       Public Store
   │                                   │                                  │
   ├─ DMs photo(s) + caption ─────────►│                                  │
   │  (e.g. 4 photos of a hoodie       │ 1. Buffers album (2.5s burst)    │
   │   + "Prix 65 DH, Colis de 10")    │ 2. Saves images & thumbnails     │
   │                                   │ 3. Posts directly to supplier's  │
   │                                   │    Telegram Channel              │
   │                                   │ 4. Creates Jemlix "Submission"   │
   │                                   │                                  │
   │◄─ "توصّلنا بـ 4 تصاور ✅          │                                  │
   │    تسجلات كمنتج، غتراجع..." ──────┤                                  │
   │                                   ├──── Notifies Admin ─────────────►│
   │                                   │                                  │
                                       ▼                                  │
                          Admin reviews in /admin                         │
                          Submissions ─► "Add to catalog"                 │
                          & clicks Publish                                │
                                       │                                  │
   │◄─ "تم نشر منتجك: [اسم المنتج]" ───┴─────────────────────────────────►│ (Live at /c/slug)
```

* **Album Burst Buffering:** The bot collects multi-photo albums (`media_group_id`) over a 2.5-second buffer window and stores them as **one single submission** instead of individual fragmented posts.
* **Immediate Channel Post:** The bot posts to the supplier's channel immediately, keeping their Telegram channel active with zero delay.
* **Catalog Curation:** The product appears on `jemlix.com` only after admin review, ensuring catalog consistency and data quality.
* When published, the bot sends an automated confirmation message to the supplier's Telegram chat.

---

### Flow F: Supplier Passwordless Self-Service Portal (`/code`)

Suppliers can adjust their own prices, update MOQ, or mark items out of stock without contacting you:

1. Supplier sends `/code` to `@JemlixBot`.
2. Bot replies with a one-time 6-digit code valid for 10 minutes:
   > كود الدخول: `482910` — صالح لمدة 10 دقايق. دخلو هنا: jemlix.com/supplier
3. Supplier opens `jemlix.com/supplier`, enters the 6 digits, and receives an HTTP-only authenticated cookie valid for 7 days.
4. **Portal Capabilities (`public/supplier.html`):**
   * Search and filter all their owned products.
   * Update Price, Price on Request, and Wholesale Tiers.
   * Edit MOQ and Stock notes (e.g. "متوفر" vs "بالطلب").
   * Toggle visibility (Hide sold-out items / Show back in stock).
5. **Revocation:** If a supplier loses their phone, sending `/logoutall` to the bot immediately revokes all active browser sessions.
6. **Auditability:** All supplier edits are logged in `supplier_product_edits` and displayed in the Admin activity timeline.

---

### Flow G: Commercial Billing Lifecycle & Store Statuses (CRM Matrix)

Subscription statuses in [`src/supplier-crm.ts`](file:///home/iharoud/Documents/GitHub/jemla/src/supplier-crm.ts) control both administrative tracking and public catalog visibility:

| Subscription Phase | Trigger / Conditions | Admin Action | Public Store Visibility (`/c/<slug>`) |
| :--- | :--- | :--- | :--- |
| **`trial`** | Onboarding completed, 14-day trial active | Monitor usage & queue products | **Active & Live** |
| **`trial_ending`** | $\le 7$ days before trial end | Outreach with view analytics | **Active & Live** |
| **`trial_ended`** | Trial expired, no payment recorded | Contact for subscription decision | **Active & Live** until manually paused |
| **`active`** | Paid monthly/quarterly subscription | Regular submission reviews | **Active & Live** |
| **`due_soon`** | $\le 7$ days before next due date | Send invoice / reminder | **Active & Live** |
| **`due_today`** | Due date reached | WhatsApp follow-up | **Active & Live** |
| **`grace`** | Overdue but within grace window (e.g. 5 days) | Follow up on cash/transfer | **Active & Live** (prevents abrupt cutoff) |
| **`overdue` / `paused`** | Grace period expired without payment | Set supplier status to `paused` | **Instantly Hidden** (Returns 404; products hidden) |
| **`churned`** | Supplier permanently leaves | Archive records; leave channel | **Hidden** |

> [!IMPORTANT]
> Operational store status (`active` vs `paused`) is separated from billing phase (`trial`, `due_soon`, `grace`). A temporary payment delay never automatically disrupts a supplier's store until an administrative decision is made.

---

### Flow H: Buyer Discovery & Direct Ordering

1. Buyers browse the mobile-first catalog (`jemlix.com` or direct store link `jemlix.com/c/<slug>`).
2. Search by title, filter by category, view wholesale price tiers and Minimum Order Quantity (MOQ).
3. Clicking **"تواصل مع البائع"** (Contact Supplier) opens WhatsApp or Telegram with the supplier with pre-filled product details.
4. Daily store and product page views are recorded in SQLite and surfaced in the Admin Supplier Drawer to demonstrate real buyer demand during monthly renewal discussions.

---

## 5. Scenario & Edge Case Handling Matrix

| Scenario | System Behavior & Fallback |
| :--- | :--- |
| **Supplier sends multi-photo album** | `src/bot.ts` groups messages by `media_group_id` using a 2.5s timer. Consolidates into one submission with all photos attached. |
| **Supplier sends photos individually** | Bot accepts each photo, but automatically includes an educational Darija tip: *"باش تزيد تصاور لنفس المنتج، صيفطهم مجموعين فرسالة وحدة"*. |
| **Bot removed as channel admin** | Channel posting fails safely; submission delivery status recorded as `failed`. Admin notified; supplier advised via bot to re-promote bot. |
| **Interrupted registration** | Step is saved to SQLite (`onboarding_step`). When the supplier messages the bot hours or days later, it prompts for the missing detail (Name or WhatsApp). |
| **Channel link mismatch / dispute** | Forwarded channel post creates an audit suggestion only. Final link requires promotion by the registered user or manual link verification in Admin. |
| **Supplier requests custom URL slug** | Supplier runs `/setslug <name>` in bot. System validates slug format and uniqueness, saves as pending admin review. |
| **Supplier stops paying subscription** | Admin sets supplier status to `paused`. Store `/c/<slug>` and all products disappear from public view immediately. Re-activating instantly restores them. |

---

## 6. Technical Architecture & Database

Runs as a single lightweight Bun process:
```
src/index.ts   → HTTP Server (Public catalog, Admin API, Supplier Portal, Media server)
src/bot.ts     → grammY Bot (Polling, channel publishing, DM intake, /code generator)
src/import.ts  → CLI Importer (Telegram Desktop JSON import, thumbnail generator)
src/db.ts      → SQLite with WAL mode (data/jemla.db)
```

### Key Tables:
- `suppliers`: Registered Telegram sellers, WhatsApp contacts, linked channel ID, slug, and status (`pending`, `active`, `paused`).
- `submissions`: Inbound products from Telegram DMs, image arrays, delivery status (`posted`, `failed`), and approval link to `products.id`.
- `products`: Catalog items with wholesale prices, tiers, MOQ, categories, stock status, and channel associations.
- `posts`: Raw imported posts from Telegram Desktop exports, keyed by `(channel, msg_id)` for idempotent upserts.
- `supplier_subscriptions`: Recurring agreement, billing cycle, current period, next due date, and grace days.
- `supplier_payments`: Immutable ledger of received payments (kind: `onboarding` or `subscription`).
- `supplier_events`: Unified audit timeline of channel links, logins, product edits, payments, and admin notes.

---

## 7. Launch & Operational Outreach Runbook

### Gate 1: Infrastructure & Environment
- Production domain: `jemlix.com` behind Caddy reverse proxy on Hetzner VPS.
- Application bound locally to `127.0.0.1:3001`.
- Secrets in `/etc/jemla/jemla.env`: `ADMIN_TOKEN`, `BOT_TOKEN`, `SUPPLIER_AUTH_SECRET`, `PUBLIC_BASE_URL`.

### Gate 2: Direct Outreach Scripts

**French Outreach Message:**
> Bonjour, je travaille sur Jemlix, un service qui transforme les catalogues Telegram des grossistes en boutique web organisée. J'ai vu votre canal et je pense qu'il se prête bien au format. Je peux préparer gratuitement un test de 60 produits, sans modifier votre manière de publier. Si le résultat vous convient, on discute ensuite de la maintenance. Est-ce que je peux vous montrer un exemple ?

**Darija Outreach Message:**
> سلام، كنخدم على Jemlix، خدمة كتحول كاطالوغ تيليغرام ديال تجار الجملة لمتجر ويب منظم. شفت القناة ديالكم وبانت ليا مناسبة. نقدر نوجد ليكم تجربة مجانية فيها 60 منتج بلا ما تبدلو طريقة الخدمة ديالكم. إلا عجباتكم النتيجة نهضرو من بعد على الصيانة. واش نقدر نصيفط ليكم مثال؟

### Gate 3: Pilot Operation Metrics
For the first 3–5 suppliers, track:
1. Total images reviewed vs. final products published.
2. Curation minutes per product.
3. Frequency of price/MOQ updates through `/code` supplier portal.
4. Total buyer click-throughs to WhatsApp/Telegram from store pages.
5. Conversion from initial free catalog build to paid recurring subscription.
