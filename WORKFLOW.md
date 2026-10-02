# Jemlix — supplier & product workflow

Status: implementation ready for launch review 2026-09-30. Phases 1–3 are in
code; bot polling is active only when `BOT_TOKEN` is set. Production deployment
and a real-supplier pilot are not complete yet.
Sprint 2026-09-29 done: public catalog shows active-supplier + legacy stores only;
publish requires name/category/image/price-or-on-request/MOQ/supplier/contact (drafts exempt);
PATCH /api/products/:id for edits; onboarding_step resumes after restarts;
albums grouped via media_group_id with (supplier_id, tg_message_id) idempotency and
posted/failed delivery status; imports upsert on (channel, msg_id) preserving status/links.

## Principle

The bot is the supplier's **single place to post**. One message → the supplier's
Telegram channel (the bot re-posts it) **and** your catalog review queue. The
supplier never posts in two places. You curate. **No seller passwords or account setup.**

## Actors

- **Supplier** — owns a Telegram channel, sells wholesale.
- **Bot** — a Telegram bot you control. Admin of each supplier's channel.
- **You (admin)** — the Jemlix dashboard (`/admin`). Reviews and publishes.
- **Buyer** — browses the public catalog. No account.

## Why this works

A bot cannot *read* a channel, but it **can post** to a channel it administers.
So instead of trying to read the supplier's channel, the bot becomes the
*source*: the supplier sends products to the bot, and the bot publishes to the
channel. No scraping, no user-session, no ban risk.

## Flows

### A. Onboarding (once)

```
Supplier  /start  →  Bot asks: name?  whatsapp?
                     Bot: "أضفني مديرا فالقناة ديالك" (add me as channel admin)
Supplier adds bot as admin
                     Bot receives my_chat_member → learns channel id + title
                     Bot matches the exact Telegram user id → links supplier
You   → dashboard → review supplier → set store slug + contact → active
```

The supplier record is created during `/start`, before channel linking. Pending
status is not used for matching: every supplier has a unique Telegram user ID,
and `my_chat_member.from.id` identifies the exact person who promoted the bot.
This stays unambiguous even when many suppliers are pending.

A forwarded channel post uses the current Bot API `forward_origin` field (with
legacy `forward_from_chat` support) to **suggest** a channel. It does not prove
ownership because anyone can forward a public post. The link becomes confirmed
only after the same registered Telegram account adds the bot as channel admin.
If another administrator performs that action, Jemlix leaves the link unconfirmed
for manual review. An existing supplier link cannot be silently replaced, and a
channel already claimed by another supplier is rejected.

### B. Existing catalog (once per supplier)

```
You  → Telegram Desktop → export the supplier's channel
You  → copy the export to the Jemlix machine/VPS
You  → run the CLI importer with the exact supplier id (`--supplier <id>`)
You  → structure products (existing curation) → publish
Store live: /c/<slug>  →  Bot messages the supplier their link
```

The importer is currently a command-line operation, not a dashboard upload.
Once production lives on the VPS, importing on the laptop would update only the
laptop's database. Upload the untouched Telegram export folder to the VPS and
run the dry run and real import there. See `DEPLOYMENT.md` for the exact commands.

### C. New products (ongoing) — the core loop

```
Supplier  DMs the bot a product (photo + caption)
   Bot → posts it to the supplier's channel   (looks like their normal post)
   Bot → saves it as a submission (status=new) → notifies you
You  → dashboard → المرسلات → review → "أضف للكاتالوغ" (reuse curation, prefilled)
   published → appears on /c/<slug> and the main catalog
```

### D. Supplier editing (passwordless code)

```
Supplier  identified by Telegram ID (no password, no account)
   /code           → one-time 6-digit code (10 minutes)
   /supplier       → enter code → 7-day browser session
   dashboard       → search/paginate all owned products
                   → edit price / stock / MOQ / description / visibility
   /logoutall      → revoke every browser session
```

Telegram remains the identity and recovery mechanism; the product list stays in
the web dashboard so suppliers with hundreds of products do not manage ids or
long lists in chat. Codes are single-use, stored only as keyed hashes, and every
product query is scoped by the authenticated `supplier_id`.

Admin dashboard keeps its existing `ADMIN_TOKEN` gate. That is separate from
seller access and stays.

### E. Admin supplier relationship and billing record

```
You  → الموردون → open the supplier file
     → record the offer, amount, cycle, current period, next due date and grace
     → record each external payment (cash/bank/Wafacash/CMI) with its reference
     → schedule the next follow-up and add call/meeting notes
Jemlix → calculates trial / due soon / due today / grace / overdue
      → keeps an immutable payment ledger and a combined activity timeline
```

Jemlix does not collect or move money. Operational store status (`pending`,
`active`, `paused`) remains separate from the commercial subscription status
(`trial`, `active`, `paused`, `churned`), so a billing date never silently hides
a supplier's products. Code generation, supplier login/logout, session revocation,
product edits, agreement changes, payments and admin notes are auditable.

## Data model (new tables)

```sql
suppliers (
  id INTEGER PRIMARY KEY,
  telegram_id INTEGER UNIQUE,      -- seller identity
  name TEXT,
  username TEXT,
  whatsapp TEXT,
  channel_id TEXT,                 -- -100... from my_chat_member
  channel_title TEXT,
  channel_slug TEXT,               -- links to channels.slug (the store URL)
  status TEXT DEFAULT 'pending',   -- pending | active | paused
  created_at TEXT
);

submissions (
  id INTEGER PRIMARY KEY,
  supplier_id INTEGER,
  tg_message_id INTEGER,
  text TEXT,
  image TEXT,                      -- copied into media/
  status TEXT DEFAULT 'new',       -- new | published | skipped
  product_id INTEGER,
  created_at TEXT
);
```

Links: `suppliers.channel_slug` ↔ `channels.slug`.
`submissions.product_id` ↔ `products.id`.
`products.source_channel` already ties a product to a channel/store.

The CRM adds `supplier_subscriptions` (one current agreement per supplier),
`supplier_payments` (append-only external payment records), and `supplier_events`
(the unified audit timeline). Money is stored in centimes as integer minor units.

## Architecture

One Bun process (same pattern as autowork):

```
src/index.ts   → HTTP server (catalog, admin API, media)   [exists]
src/bot.ts     → grammY bot: polling + channel posting      [new]
src/import.ts  → Telegram Desktop import (per supplier)     [exists, extend]
src/db.ts      → + suppliers, submissions                   [extend]
DB             → same SQLite (data/jemla.db)
```

Bot and server share the DB. Bot handles Telegram; server handles web.

## Phases

### Phase 1 — data model + dashboard (no bot)
- Add `suppliers` + `submissions` tables
- Admin tab **الموردون**: add supplier, set channel + slug + contact + status
- Admin tab **المرسلات**: submissions queue (manual until the bot exists)
- Import: `bun run import -- <export-folder> --supplier <id>`
- *Done when:* you can add a supplier, import their channel, structure, publish,
  and the store shows under their name at `/c/<slug>`.

### Phase 2 — the bot
- Add grammY; `src/bot.ts` runs in the same process
- `/start` → collect name + whatsapp → ask them to add the bot as channel admin
- `my_chat_member` → capture channel id/title → link to supplier
- A product (photo+caption) from a linked supplier → **post to their channel** +
  save a submission → notify you
- `/mystore`, `/myproducts`, `/mylink` for the supplier
- When you publish → notify the supplier
- *Done when:* a supplier can onboard, send a product, see it in their channel,
  and it appears in your المرسلات queue.

### Phase 3 — glue
- Submission → "كوّن منتج" prefilled (reuse curation)
- Auto-associate submissions by `telegram_id`
- Supplier status: pause → hide their store; active → show
- Seller edits price/stock/MOQ/description/visibility in the passwordless web
  portal opened with `/code`; bot edit commands redirect there.

## Product decisions (current)

1. **Channel publishing** — the supplier sends new products to the bot. The bot
   posts them to the supplier channel and creates a Jemlix submission.
2. **Moderation** — channel publishing is immediate; Jemlix catalog publication
   waits for admin review.
3. **Seller edits** — `/code` creates a one-time code for the web product portal.
   No passwords and no long product lists inside Telegram.
4. **Store slug** — the supplier may request one with `/setslug`; the admin
   reviews it and remains responsible for the final public store URL.

## Reality check

The initial per-supplier Telegram Desktop export is manual and will not scale
past a handful of suppliers. That is fine for the first 5–10. Automate with a
scraper only after the loop is proven and worth it.

## Launch workflow for review

The immediate strategy is direct supplier outreach, not paid advertising. That
is appropriate for the pilot because Jemlix still needs to learn the real cost
of cleaning, grouping and maintaining Moroccan Telegram catalogs.

### Gate 1 — identity and infrastructure

- [x] Production domain purchased: `jemlix.com`.
- [ ] Point the root and `www` DNS records to the Hetzner server.
- [ ] Create `Jemlix | جملة` with the official `@BotFather` and save the token
  only in the server environment.
- [ ] Deploy to Hetzner with the app bound to `127.0.0.1:3001` behind Caddy.
- [ ] HTTPS works and HTTP redirects to HTTPS.
- [ ] Hetzner Firewall exposes only 80/443 publicly; SSH is restricted.
- [ ] Hetzner deletion protection is enabled. Backups are deferred during the
  disposable pilot and added before the catalog becomes difficult to recreate.
- [ ] `ADMIN_TOKEN`, `BOT_TOKEN` and `SUPPLIER_AUTH_SECRET` are long, different
  values and do not exist in Git.

Detailed commands and rollback instructions are in `DEPLOYMENT.md`.

### Gate 2 — private acceptance test

Use your own Telegram account and a private channel. Test the complete path,
not isolated screens:

```
/start → name → WhatsApp → add bot as channel admin
        → admin activates supplier and assigns slug
photo/caption to bot → supplier channel + Jemlix submissions
        → admin reviews and publishes → public supplier store
/code → supplier portal → edit price/stock/MOQ/visibility
/logoutall → existing supplier sessions stop working
```

- [ ] Single photo works.
- [ ] Multi-photo album works once, without duplicates.
- [ ] A failed channel post is visible as failed in Admin.
- [ ] Product publication requires the expected commercial fields.
- [ ] Arabic and French public pages work on phone and desktop.
- [ ] Admin and supplier sessions work only over HTTPS in production.

### Gate 3 — first supplier offer

Do not promise unlimited manual work. Use a deliberately small pilot offer:

- First 60 structured products: free trial.
- Store + Telegram synchronization: proposed 99 DH/month after trial.
- Larger initial imports: quoted as a fixed package after inspecting the
  channel; media count is not treated as product count.
- Every scope is written in the supplier CRM: included product count, import
  assumptions, maintenance allowance, trial end, next payment and follow-up.

This pricing is still a pilot hypothesis. Measure minutes of work per final
product before making it permanent.

### Gate 4 — direct outreach

Start with three suppliers, not thirty. Prefer active channels with clear
product photos, visible prices or wholesale terms, and an owner reachable by
Telegram or WhatsApp.

For every prospect:

1. Check the channel manually: approximate posts, estimated final products,
   duplicated media, price quality and categories.
2. Send a short personal message referencing their actual catalog. Do not send
   the same bulk message to many channels.
3. Explain the outcome: Jemlix structures the catalog and keeps new Telegram
   products synchronized; the supplier does not upload everything twice.
4. Offer the 60-product pilot and state clearly what happens after it.
5. Only create the supplier in Jemlix after they show interest. Record the
   agreed scope, trial end and next follow-up.
6. Ask permission before exporting or republishing their catalog and before
   adding the bot as channel administrator.

Suggested first message in French:

> Bonjour, je travaille sur Jemlix, un service qui transforme les catalogues
> Telegram des grossistes en boutique web organisée. J'ai vu votre canal et je
> pense qu'il se prête bien au format. Je peux préparer gratuitement un test de
> 60 produits, sans modifier votre manière de publier. Si le résultat vous
> convient, on discute ensuite de la maintenance. Est-ce que je peux vous
> montrer un exemple ?

Suggested first message in Darija:

> سلام، كنخدم على Jemlix، خدمة كتحول كاطالوغ تيليغرام ديال تجار الجملة لمتجر
> ويب منظم. شفت القناة ديالكم وبانت ليا مناسبة. نقدر نوجد ليكم تجربة مجانية
> فيها 60 منتج بلا ما تبدلو طريقة الخدمة ديالكم. إلا عجباتكم النتيجة نهضرو من
> بعد على الصيانة. واش نقدر نصيفط ليكم مثال؟

### Gate 5 — pilot operations

For each of the first three suppliers:

```
permission → supplier record → private sample → channel export/import
→ clean 60 products → supplier approval → activate public store
→ train on /code and new-product bot flow → 7-day check-in
→ record time/corrections → decide continue, revise or stop
```

Track at minimum:

- Total media inspected and final products created.
- Manual minutes per product.
- Percentage requiring category/name/price correction.
- New products per month.
- Supplier edits made through the portal.
- Buyer contacts generated.
- Trial end, next follow-up and payment status.

### Launch decision after three pilots

Continue to ten suppliers only if the complete bot flow is stable, suppliers
can use `/code` without help, and the measured manual work fits the proposed
pricing. Before the catalog becomes difficult to recreate, enable and test the
prepared backup workflow. Otherwise fix the workflow or pricing before adding
more suppliers.
