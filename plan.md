# Jemlix improvement plan

Scanned 2026-09-29 against the code that is actually in this folder, plus the server already listening on port 3001.

## Verdict

This is a working prototype, not a product. The job is right: import a Telegram export, curate posts by hand, publish a wholesale catalog. The execution is a weekend script wearing a storefront.

What exists today:

- `src/index.ts` (147 lines) — one Bun server, no auth, no validation
- `src/import.ts` (86 lines) — copies a Telegram `result.json` into SQLite and `./media`
- `src/db.ts`, `src/config.ts` — two tables, categories and a default phone hardcoded
- `public/catalog.html` (126 lines) and `public/admin.html` (315 lines) — Tailwind from a CDN, all CSS and JS inline
- 2,725 posts, 1 published product, 323 MB of original JPEGs
- No git repo, no `.gitignore`, no README, no tests, no favicon, no build

Do not rewrite this into a monorepo, a React app, or an AI pipeline. Fix the thing buyers and the curator actually touch, in the order below.

## What already works

Keep these. They are the product.

- The curation move is correct: multi-select Telegram posts, merge text and photos, publish one catalog item.
- SQL uses bound parameters. That part is fine.
- Darija in the UI matches Moroccan wholesale buyers. Do not "professionalize" it into stiff Modern Standard Arabic or English.
- SQLite in WAL mode is the right database until there is a second user or a second machine.
- One process serving pages, JSON, and images is fine at this size.

## Why it looks unfinished

### Brand

The wordmark is the emoji `🛍️` plus the word Jemlix, in `font-bold`, on a white bar. That is the entire identity. There is no favicon (the browser gets a plain 404), no color that belongs to Jemlix, and no sentence that says who this is for.

Default Tailwind does the rest: `blue-600` prices, `green-500` contact button, `slate-100` photo wells, `rounded-xl` on everything. A buyer cannot tell this from a tutorial.

### Type

`system-ui` is a Latin UI font. Arabic and Darija fall back to whatever the OS has, which on Linux is often a mismatched Naskh. Headlines, prices, and body never share a designed Arabic face. Latin bits (`DH`, `MOQ`, `WhatsApp`, `Admin`) sit in a different voice from the Darija labels.

### Catalog (`public/catalog.html`)

- Header is one row: logo, search, category `<select>`. On a phone those three fight for one line. Buyers are on phones.
- Cards are a photo, a two-line clamp, a grey category, and a blue price. No MOQ, no stock, no seller until the modal. For wholesale those facts are the product.
- The only published item is named `🛍️✨🔥` with an empty category, empty price, and empty description, because the admin copies the first line of the Telegram post and that line is emoji. The catalog has no defense against that.
- Empty state is one grey sentence, `ما كاين حتى منتج حاليا`.
- Modal dumps every photo in a 2-column grid at a fixed height. No gallery, no swipe, no zoom. Close is a `✕` with no Escape key and no focus trap.
- The contact button is always WhatsApp-green, labeled `تواصل مع البائع ✓`, even when the link is Telegram.
- Search and category run entirely in the browser, over whatever `/api/products` returned. Fine for one product. Not a catalog.
- Product name, description, category, and channel are injected with `innerHTML`. A Telegram post containing HTML becomes HTML in the page.
- Price is free text plus a hardcoded ` DH`. `45 DH` and `45 DH DH` are both possible. Nothing sorts by price.

### Admin (`public/admin.html`)

This screen is the product for you, and it is built like a form demo.

- The published-products list lives *inside* `#editor`, which starts hidden. You cannot see what is already live until you select posts and press `كوّن منتج`.
- Layout is `h-screen` plus a fixed `340px` column. There is no small-screen layout.
- The queue paints 100 rows, then "show more". Filtering re-renders HTML strings. 2,725 posts means a 1 MB JSON payload (`/api/posts` measured at 1,029,694 bytes) on every load.
- `+ زيد صور` fetches all 2,725 filenames and puts an `<img>` for each in the DOM. That is the moment the admin becomes unusable.
- Hover-zoom is mouse-only. Curation on a trackpad or a phone gets nothing.
- Status `skipped` is styled and never set. There is no filter for new / done / skipped. You scroll the same 2,725 rows forever.
- Publish uses `alert()`. Delete uses `confirm()`. Success is "the form disappeared".
- You cannot edit a product. Delete does not return the source posts to `new`, so the queue stays marked done and the catalog item is gone.
- `product_id` exists on `posts` and is never written.
- Contact choices are built by concatenating phone numbers into an `onclick` string.

### Photos

Sample files are 1080×1080 and 1368×1500, 54–170 KB each, served at full size with no `Cache-Control`. A card only needs a square around 400 px. 323 MB of originals with no thumbnails will be the catalog's loading time as soon as more than a handful of products are published.

## Why it is not safe to put online

The server is bound to `*:3001`, not localhost. These are true on that process today:

1. **Admin is public.** `POST /api/products`, `DELETE /api/products/:id`, and `PATCH /api/posts/:id` have no password. `/api/config` returns the default WhatsApp number. `/api/posts` returns every post, including seller phones.
2. **Files leak outside `media/`.** Image URLs are `./media/` plus the decoded path. Encoded `..` segments leave the folder. Requesting that shape of URL returned `package.json` and `src/config.ts` with status 200. The same join can reach `data/jemla.db`.
3. **Secrets live in source.** `src/config.ts` has a personal Moroccan number and `https://t.me/CHANNEL`. `src/import.ts` has a machine-specific path, `/home/iharoud/Downloads/Telegram Desktop/ChatExport_2026-09-29`.
4. **Bad JSON is treated as an empty product.** `body()` swallows parse errors and returns `{}`. The insert then publishes a blank row (`published` is hardcoded to `1`).
5. **Re-import destroys curation.** Importing a channel runs `DELETE FROM posts WHERE channel = ?` and reinserts everything as `new`. Done / skipped work for that channel is gone. Products keep pointing at filenames that may no longer match.
6. **No cache, no security headers, no request size limit.** Responses have `Content-Type` and nothing else.

`public` + pathname did not escape the folder in a quick check, because the URL parser collapses dot-dot before the handler. Do not rely on that. Resolve every file path and reject it unless the real path stays inside `public/` or `media/`.

## Target

A buyer on a phone should open Jemlix and see a trade catalog: a real name, a price, a minimum order, stock, who is selling, and one clean photo. A curator should clear a channel without the tab dying.

Stay on Bun, SQLite, and server-rendered or static HTML until the catalog has hundreds of *published* products and a second operator. The upgrade is design and hygiene, not a new stack.

Visual direction, so the work does not drift back to default Tailwind:

- Wordmark: `Jemlix` in an Arabic-capable face. No emoji in the logo.
- Type: one family for Arabic and Latin. IBM Plex Sans Arabic or Cairo, self-hosted. Weights 400, 500, 600 only.
- Color: ink `#14221c`, paper `#f6f4ef`, one accent (a deep green, not Tailwind blue plus WhatsApp green). Price in ink, not blue. The WhatsApp action can be green; nothing else should be.
- Photos: square crop, warm grey well `#ece8e1` when the file is missing. Never a broken image icon.
- Space: 8 px grid. Cards with a 1 px border, almost no shadow. Hover lifts 1 px, not a bounce.
- Tone: keep Darija. Short labels. No exclamation marks, no checkmarks glued onto buttons.

## Work, in order

Each phase is done only when the check at the end passes. Do not start a later phase to avoid an earlier one.

### 0. Stop shipping the prototype as-is

This is blocking. Nothing visual matters while the process on `*:3001` can hand out the database.

- Bind to `127.0.0.1` unless a reverse proxy is in front.
- Put a shared password on `/admin` and on every method that is not `GET` of published products, categories, and media. A single `ADMIN_TOKEN` in the environment, checked as a header or cookie, is enough. No accounts, no OAuth.
- `GET /api/products` returns published rows only. Remove `?all=1` from the public surface; the admin calls a separate route.
- Stop returning raw posts, phones, and config to anonymous callers.
- For every file response, resolve the path and refuse it when the real path is not inside `media/` or `public/`.
- Move `defaultWhatsapp`, `defaultChannel`, port, and `EXPORT_DIR` to environment variables. Delete the home-directory path from `import.ts`. Add `.env.example` with empty values.
- Add `.gitignore` for `node_modules/`, `data/*.db*`, `.env`, and decide media policy: git-lfs or, more likely, media stays on disk and is not in git. 323 MB of JPEGs does not belong in a repo.
- `git init` only after the ignore file exists. Do not commit `data/jemla.db` (it contains seller numbers) or `media/`.
- Reject product writes with an empty name, a category outside the list, or a non-array `images`. Return 400, do not insert.
- On publish, set `posts.product_id`. On delete, set those posts back to `new`.

**Done when:** an anonymous request cannot write, cannot list unpublished posts, and cannot read `package.json` or the database through `/media/`. `git status` does not list `data/` or `media/`.

### 1. Make the catalog look like a shop

Still two HTML files. No framework.

- Drop the Tailwind CDN script. Either a small authored stylesheet (`public/catalog.css`, `public/admin.css`) or a pinned Tailwind build. The CDN play script is not a production stylesheet, and it makes the page depend on a third party for layout.
- Add the typeface, the palette, a favicon, and a `theme-color`.
- Header: wordmark, then a search that is full width on small screens, categories as a horizontal scroller under it. Not a squeezed `<select>` in the top bar.
- Card: photo, name, price, MOQ if present, source channel as quiet text. Category is a filter, not the second most important line.
- If the stored name is only emoji or shorter than a real title, show a fallback (`منتج بدون اسم`) and surface that row in the admin as incomplete.
- Modal becomes a product page pattern even if it stays a dialog: one large photo, thumbnails, price, MOQ, stock, description, one contact action whose label matches the channel (WhatsApp or Telegram). Escape and backdrop click close it. Body scroll locks.
- Empty, loading, and image-error states are designed, not a grey div.
- Footer: one line on what Jemlix is (كاتالوغ جملة، الطلب مباشرة من المورد) and that prices are as published by the seller. No fake company legal block.
- Escape every string that is interpolated into HTML. Use `textContent` for names.

**Done when:** a phone-width browser shows a readable header, a card that states price and MOQ, a modal that is not a stack of stretched photos, and no emoji in the logo. View at 390 px and at 1280 px.

### 2. Make curation faster than scrolling Telegram

- Move the published list out of `#editor` so it is visible on load. Add edit, not only delete.
- Add queue filters: new, done, skipped, and channel. Default to `new`.
- Add `تخطي` so a post can be marked skipped without becoming a product. Persist it with the existing `status` column.
- Do not load all posts or all images. Paginate `/api/posts` (channel, status, search, cursor). The image picker searches; it does not render 2,725 thumbnails.
- Generate a thumbnail on import (longest edge ~480 px, JPEG or WebP) and serve that in the queue and the catalog grid. Keep the original for the modal.
- Send `Cache-Control` on media. Thumbnails can be cached hard; they are content-addressed by filename.
- Replace `alert` / `confirm` with inline text on the form.
- Keyboard: `j` / `k` move the queue, `x` toggles selection, Enter builds the product. Hover-zoom can stay for mouse users; selection must not depend on it.
- Stop using the first line of the post as the name when that line is emoji. Leave the name empty and focus the field.
- Price and MOQ inputs are numbers. Store minor units or a plain integer of dirhams, not an arbitrary string. Display `45 د.م` in one place.

**Done when:** opening admin with 2,725 posts does not download 1 MB of JSON or a wall of images, skipped posts leave the default queue, and a published product can be edited.

### 3. Make the data match the catalog

Schema changes, still SQLite.

- `products.price_mad INTEGER`, `products.moq INTEGER NULL`, `products.stock_qty INTEGER NULL`, `products.stock_note TEXT` for messy cases ("بالطلب").
- `products.slug` or just keep numeric ids, but stop publishing rows with `published` forced to 1. Draft versus published has to be real if the admin can save unfinished work.
- Unique `(channel, msg_id)` on posts so a re-import upserts instead of deleting the channel. Preserve `status` and `product_id` when the message id already exists.
- Validate `images` entries as bare filenames. No slashes.
- Index `posts(status, channel)` and `products(published, category)`.

**Done when:** re-importing the same export does not flip done posts back to new, and the catalog can sort by price.

### 4. Baseline a stranger could run

- README: what it is, `bun install`, env vars, `bun run import -- /path/to/ChatExport`, `bun run dev`, which URL is public and which is admin.
- `tsconfig` with strict mode. Replace `any` on request bodies with a small parser, not a second framework.
- Tests for: phone extraction, path refusal, product validation, import upsert keeping status. Bun's test runner is enough.
- Pin `@types/bun` to the version you installed. `"latest"` is not a dependency.
- A single error shape: `{ error: string }` and a 500 handler that does not print SQL to the client.

**Done when:** `bun test` passes on a machine that does not have your Downloads folder, using only `.env.example` as the guide.

## Do not do these

- Do not add an LLM to "clean" the 2,725 posts. The admin exists because the text is messy. Fix the queue so a person can go through it.
- Do not introduce React, Next, Postgres, Redis, or a component library for two pages.
- Do not redesign the Darija. The amateur look is the type, the emoji, the default blue, and the missing trade facts. It is not the language.
- Do not commit the database or the media folder once git exists.
- Do not build buyer accounts, carts, or checkout. The contact button is the conversion. A cart with no payment is more fake, not more professional.

## Suggested first session

1. Phase 0, entirely. Re-check the three anonymous requests (write, list posts, read a file outside `media/`).
2. From phase 1, only the stylesheet, wordmark, type, card, and mobile header.
3. From phase 2, only the published-list bug, the `new` filter, and thumbnails.

That is the difference between "a Tailwind page on a script" and a catalog you can show someone.
