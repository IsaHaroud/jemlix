# Jemlix production deployment

This runbook deploys one Bun process (website + Telegram polling bot) behind
Caddy on a Hetzner Cloud server. It deliberately keeps the Bun port private;
only Caddy receives public HTTP/HTTPS traffic.

The commands assume Ubuntu/Debian, `/opt/jemla` for the application and the
production domain `jemlix.com`. The internal Linux user and paths keep their
existing `jemla` names so current databases and server scripts remain compatible.

## 1. Before touching the server

- Domain purchased: `jemlix.com`.
- Point the root `A` record for `jemlix.com` to the Hetzner server IPv4 address.
  Point `www` to the same server with either an `A` record or a `CNAME` to the
  root domain. Add an `AAAA` record only when IPv6 is configured on the server.
- Create the bot in the official `@BotFather` chat with `/newbot`.
- Suggested bot name: `Jemlix | جملة`.
- Suggested usernames, subject to Telegram availability: `JemlixBot`,
  `JemlixMarocBot`, or `JemlixSupplierBot`.
- Keep the BotFather token private. Never paste it into Git, screenshots or a
  supplier conversation.
- Create a Hetzner server with enough local disk for the imported Telegram
  media. Start with at least 2 vCPU, 4 GB RAM and 40 GB local storage, then size
  disk capacity from the real export volume.
- Add a Hetzner Cloud Firewall: TCP 80 and 443 from anywhere; TCP 22 only from
  your own IP. Leave the Bun port `3001` closed.
- Enable deletion protection. Hetzner/application backups can be added later;
  they are not required for the first disposable pilot catalog.

## 2. Prepare the server

Install the basic tools, Bun and the official Caddy package. Follow the current
official Bun and Caddy installation pages if their commands change.

```bash
sudo apt update
sudo apt install -y unzip sqlite3 rsync curl gnupg debian-keyring debian-archive-keyring apt-transport-https
sudo useradd --system --create-home --shell /bin/bash jemla
sudo -iu jemla bash -lc 'curl -fsSL https://bun.com/install | bash'
sudo ln -s /home/jemla/.bun/bin/bun /usr/local/bin/bun
```

Install Caddy from its official Debian/Ubuntu repository, then verify both
runtimes:

```bash
bun --version
caddy version
```

Create the application and secret directories:

```bash
sudo install -d -o jemla -g jemla -m 0750 /opt/jemla
sudo install -d -o jemla -g jemla -m 0750 /opt/jemla/data /opt/jemla/media
sudo install -d -o root -g jemla -m 0750 /etc/jemla
```

## 3. Upload Jemlix

This project does not yet have a configured Git remote, so the first deployment
should use `rsync` from the project directory on your computer:

```bash
rsync -az \
  --exclude '.git' --exclude '.env' --exclude 'node_modules' \
  --exclude 'data' --exclude 'media' \
  ./ root@SERVER_IP:/opt/jemla/
```

On the server:

```bash
sudo chown -R jemla:jemla /opt/jemla
sudo -iu jemla bash -lc 'cd /opt/jemla && /usr/local/bin/bun install --production --frozen-lockfile'
sudo -iu jemla bash -lc 'cd /opt/jemla && /usr/local/bin/bun test'
```

Copy existing production data only once. Do not overwrite a live server's
`data/` or `media/` during later code deployments.

## 4. Production secrets

Create `/etc/jemla/jemla.env` on the server, not in the repository:

```dotenv
HOST=127.0.0.1
PORT=3001
ADMIN_TOKEN=GENERATE_A_LONG_RANDOM_VALUE
DEFAULT_WHATSAPP=212600000000
DEFAULT_CHANNEL=
BOT_TOKEN=TOKEN_FROM_BOTFATHER
ADMIN_CHAT_ID=
PUBLIC_BASE_URL=https://jemlix.com
SUPPLIER_AUTH_SECRET=GENERATE_ANOTHER_LONG_RANDOM_VALUE
```

Generate both secrets independently with `openssl rand -base64 36`, then lock
the file:

```bash
sudo chown root:jemla /etc/jemla/jemla.env
sudo chmod 0640 /etc/jemla/jemla.env
```

`ADMIN_CHAT_ID` may be empty for the first start. Message the bot with `/id`,
copy the returned numeric ID into the environment file, and restart Jemlix.

## 5. DNS and Caddy

Create an `A` record for the root domain pointing to the server IPv4 address.
Create `www` as a `CNAME` to the root. Add an `AAAA` record only when the server
has working public IPv6.

The included `deploy/Caddyfile` already uses `jemlix.com`. After DNS resolves:

```bash
sudo cp /opt/jemla/deploy/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy obtains and renews HTTPS automatically once DNS points to the server and
ports 80/443 are reachable.

## 6. Jemlix service

```bash
sudo cp /opt/jemla/deploy/jemla.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now jemla
```

Check health and logs:

```bash
systemctl status jemla --no-pager
journalctl -u jemla -n 100 --no-pager
curl --fail https://jemlix.com/healthz
```

Optional later: `deploy/jemla-backup.service` and `.timer` create consistent
SQLite copies under `/var/backups/jemla`. Enable them when the production data
is no longer easy to recreate.

## 7. Manual channel recovery

If automatic linking fails, do not edit SQLite directly:

1. Ask the already-registered supplier to forward one channel post to the bot.
   The forward creates a suggestion only; it does not claim ownership.
2. In Admin → Suppliers, open the correct supplier file. Its numeric Jemlix ID is
   displayed beside the supplier details.
3. In the activity timeline, copy the suggested Bot API channel ID (normally
   similar to `-1001234567890`) and verify the channel title with the supplier.
4. In **Manual channel link**, enter the channel ID, title and final store slug.
5. Save the link, then ensure the bot is actually a channel administrator with
   permission to post before activating the supplier.

Jemlix rejects a channel ID already owned by another supplier and records a
manual-link audit event. Manual linking confirms an administrative decision; it
does not magically give the bot Telegram permissions.

## 8. Importing a Telegram export created locally

After Jemlix is live on the VPS, never run the production import against the
laptop database. Export the channel locally with Telegram Desktop as JSON with
media, then transfer that complete export folder to a temporary server folder.

On the VPS, prepare an import area:

```bash
sudo install -d -o jemla -g jemla -m 0750 /var/lib/jemla-imports
```

From the local project machine, upload the untouched export folder:

```bash
rsync -az --partial --progress \
  /local/path/ChatExport/ \
  root@SERVER_IP:/var/lib/jemla-imports/supplier-12/
```

On the VPS, assign ownership and run a dry import using the supplier ID shown in
the admin supplier file:

```bash
sudo chown -R jemla:jemla /var/lib/jemla-imports/supplier-12
sudo -iu jemla bash -lc 'cd /opt/jemla && /usr/local/bin/bun run import:dry -- /var/lib/jemla-imports/supplier-12 --supplier 12'
```

Read the reported channel name, message count and photos. If the folder and
supplier are correct, run the real import while Jemlix stays online:

```bash
sudo -iu jemla bash -lc 'cd /opt/jemla && /usr/local/bin/bun run import -- /var/lib/jemla-imports/supplier-12 --supplier 12'
curl --fail https://jemlix.com/healthz
```

The importer copies media outside database transactions and writes posts in
short batches, so normal catalog reads, bot messages and admin work can continue.
Stopping Jemlix is not required. A pre-import backup is optional at this stage;
use one later when the production catalog becomes difficult to recreate or
before a risky migration.

Then open Admin → Requests, filter by that supplier and curate the imported
posts. The importer copies required files into `/opt/jemla/media` and upserts by
channel/message ID, so rerunning the same export does not create duplicate post
rows. Keep the uploaded raw export until the supplier store has been checked;
archive or remove it afterward according to your retention policy.

## 9. Bot and website acceptance test

Do this with your own Telegram account and a private test channel before adding
a real supplier:

1. Open the homepage, About, Blog, one store and one product over HTTPS.
2. Confirm `/admin` requires the admin token.
3. Send `/start` to the bot; complete name and WhatsApp onboarding.
4. Add the bot as an administrator to the private test channel with permission
   to post messages.
5. Activate the test supplier in `/admin` and give it a store slug.
6. Send one photo, one caption and one multi-photo album to the bot.
7. Confirm each item appears in the channel and in Admin → Submissions.
8. Publish one item and confirm it appears in the supplier store.
9. Send `/code`, log into `/supplier`, edit the product and verify the change.
10. Send `/logoutall` and verify the supplier session is revoked.

Do not contact the first supplier until all ten checks pass.

## 10. Updating and rollback

Upload code with the same exclusions, then run:

```bash
sudo -iu jemla bash -lc 'cd /opt/jemla && /usr/local/bin/bun install --production --frozen-lockfile'
sudo -iu jemla bash -lc 'cd /opt/jemla && /usr/local/bin/bun test'
sudo systemctl restart jemla
curl --fail https://jemlix.com/healthz
```

Before a risky update, run `sudo systemctl start jemla-backup.service`. To roll
back data, stop Jemlix, decompress a known-good backup into
`/opt/jemla/data/jemla.db`, restore ownership, then start Jemlix. Never restore a
database while the service is writing to it.
