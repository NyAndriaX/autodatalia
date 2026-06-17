# Datalia Deployment Guide

This is the **one** doc you need to put Datalia in production. Follow it
top to bottom, copy-paste the commands, and the app will be running on
your domain by the end.

> This guide uses Datalia's real production domain: **`datalia.app`**, with
> the API on **`api.datalia.app`** and the dashboard on **`app.datalia.app`**.
> If you are deploying your own copy, replace these with the domain you own
> everywhere they appear (env vars, dev-portal URLs, frontend config). The API
> host and the dashboard host MUST share the same registrable domain
> (`datalia.app`) so the `SameSite=Lax` session cookie set by `/auth/login` is
> sent on cross-subdomain requests between the dashboard and the API.

---

## Before you start

You need:

- [ ] A **Linux server** with a public IP. ~$5–10/mo Hetzner CX22, DigitalOcean droplet, Vultr, Fly.io, etc. Ubuntu 22.04+ is the tested baseline. Minimum specs: 2 vCPU, 4 GB RAM, 40 GB disk.
- [ ] A **domain name** with DNS you can edit. The convention used here is `api.datalia.app` for the backend and `app.datalia.app` for the dashboard. Both can live on the same server unless you split them. The two hosts must share the same registrable domain (here `datalia.app`) for the session cookie to work across them.
- [ ] **API keys / app credentials** ready to paste:
  - **OpenRouter** API key (`sk-or-v1-…`) — for AI text + image (Nano Banana) generation
  - **Meta** app ID + secret — Facebook + Instagram OAuth
  - **TikTok** client key + secret — TikTok OAuth
  - **Telegram bot token** — content validation gate (see Part 3)
  - **LTX-2** API key (`ltxv_…`) — AI video generation, free at [console.ltx.video](https://console.ltx.video) (100 credits no card). Optional — when unset, video gen falls back to the bundled ffmpeg Ken Burns renderer.
- [ ] **Local terminal** with SSH access — Terminal on Mac, PowerShell or WSL on Windows.

If you don't have a Telegram bot yet, do that step first (Part 3) — the credentials are needed before the first boot.

---

## Part 1 — Server setup

### 1.1 SSH in
```bash
ssh user@your-server-ip
```

### 1.2 Point your domain at the server
On your DNS host (Cloudflare / Namecheap / etc.) create **two A records** — one
for the API host and one for the dashboard (frontend) host:

| Name | Type | Value |
|---|---|---|
| `api` | A | `<your server's public IP>` |
| `app` | A | `<your server's public IP>` |

> If you serve the dashboard on the apex (`datalia.app`) instead of `app`,
> create the A record on `@` and set `FRONTEND_DOMAIN=datalia.app` accordingly.

Wait 1–5 min for propagation, then verify **both** hosts resolve to your server:

```bash
dig +short api.datalia.app
dig +short app.datalia.app
```

Both must return your server's public IP **before you start the stack in Part 5**.
Caddy provisions a Let's Encrypt certificate for each host on first request; if a
host does not yet resolve to this server, the ACME HTTP/TLS challenge fails and
cert provisioning errors out. Don't move on until both resolve.

### 1.3 Install Docker
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
exit       # log out so the group change takes effect
```
Then SSH back in.

### 1.4 Clone the repo
```bash
git clone https://gitlab.com/copyandprompt-automatisations/autodatalia.git ~/datalia
cd ~/datalia/infra
```

---

## Part 2 — Generate secrets

Create the env file, then let the helper script fill in the random secrets and
DB passwords **and write them into the file** (the old version of this guide only
echoed them to the terminal — they were never persisted, so the stack booted with
empty/placeholder secrets):

```bash
cd ~/datalia/infra
cp .env.production.example .env.production
chmod 600 .env.production          # keep secrets readable only by you
bash gen-secrets.sh                 # see infra/gen-secrets.sh
```

`gen-secrets.sh` only fills values that are still **empty** (it never overwrites
anything you've already set) and prints which variables it generated:

- `BACKEND_AUTH_TOKEN`, `JWT_SECRET`, `TELEGRAM_WEBHOOK_SECRET` → `openssl rand -hex 32`
- `MARIADB_PASSWORD`, `MARIADB_ROOT_PASSWORD` → `openssl rand -hex 16`

It is idempotent — re-running it after the values are set generates nothing. You
can also set any of these by hand in the file beforehand and the script will leave
your value alone.

> ⚠️ **MariaDB password first-init trap.** `MARIADB_PASSWORD` /
> `MARIADB_ROOT_PASSWORD` are only applied when the `mariadb-data` volume is
> created the **first** time. Generate them **now**, before the first
> `up -d --build`. If you change them later, the running database keeps the old
> password — you must `ALTER USER` inside the container or wipe the
> `mariadb-data` volume (which destroys all data). See "What gets persisted".

You'll fill in the remaining values (API keys, domains, OAuth secrets) in Part 4.

---

## Part 3 — Set up the Telegram bot

The automation module requires Telegram for the validation gate. Skip
this only if you're not using the Automation tab.

**3.1 Create the bot.** On Telegram, message **@BotFather** → send
`/newbot` → follow prompts. He gives you a token like
`123456789:ABCdef…`. Save it.

**3.2 Find your chat ID.** Two options:
- Personal chat: message **@userinfobot** — it replies with your numeric ID (positive number).
- Group chat: create a group, add the bot, send any message, then visit `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser. Find `"chat":{"id":-100…}`. Group IDs are negative.

**3.3 Register the webhook.** Once you have the bot token and the
TELEGRAM_WEBHOOK_SECRET from Part 2, run this one-time call (replace
the placeholders):

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://api.datalia.app/telegram/webhook&secret_token=<SECRET>"
```

You should get back `{"ok":true,"result":true,"description":"Webhook was set"}`. From Part 5 onward the backend handles webhook events automatically.

---

## Part 4 — Configure the app

You already created `.env.production` and generated the secrets in Part 2. Now
fill in the remaining values. Still in `~/datalia/infra` on the server:

```bash
nano .env.production
```

Fill in **every line that has an `=` followed by nothing** (the secrets/DB
passwords are already populated by `gen-secrets.sh`). The minimum required to boot:

| Variable | What to put |
|---|---|
| `API_DOMAIN` | API host — `api.datalia.app` (no `https://`, no path) |
| `FRONTEND_DOMAIN` | Dashboard host — `app.datalia.app` (no `https://`, no path) |
| `CORS_ALLOW_ORIGINS` | Frontend URL(s), comma-separated; must EXACTLY equal `https://<FRONTEND_DOMAIN>`, e.g. `https://app.datalia.app` |
| `ALLOW_OPEN_AUTH` | **`false` in production.** Setting `true` disables the auth gate on mutating routes — only ever use it for throwaway local testing. |
| `BACKEND_AUTH_TOKEN` | Generated by `gen-secrets.sh` (Part 2). Server-to-server only; never shipped to the browser. |
| `JWT_SECRET` | Generated by `gen-secrets.sh` (Part 2). The backend refuses to boot in production on an empty/placeholder value. |
| `MARIADB_PASSWORD` | Generated by `gen-secrets.sh` (Part 2). If left at the compose default it falls back to a weak `datalia`. Only applied on first volume init (see Part 2 trap). |
| `MARIADB_ROOT_PASSWORD` | Generated by `gen-secrets.sh` (Part 2). Defaults to a weak `datalia-root` if unset — do not ship that. Only applied on first volume init. |
| `AI_API_KEY` | Your OpenRouter key |
| `META_APP_ID` + `META_APP_SECRET` | From developers.facebook.com |
| `TIKTOK_CLIENT_KEY` + `TIKTOK_CLIENT_SECRET` | From developers.tiktok.com |
| `TIKTOK_DOMAIN_VERIFY` | The token TikTok gives you when verifying the domain (Part 6) |
| `TELEGRAM_BOT_TOKEN` | From Part 3 |
| `TELEGRAM_DEFAULT_CHAT_ID` | From Part 3 |
| `TELEGRAM_WEBHOOK_SECRET` | Generated by `gen-secrets.sh` (Part 2) |

Save and exit (`Ctrl+O`, Enter, `Ctrl+X` in nano).

---

## Part 5 — Start the production stack

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

First build takes 2–4 min. Watch progress with:
```bash
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f
```

Caddy automatically provisions Let's Encrypt certificates on the first requests to `API_DOMAIN` and `FRONTEND_DOMAIN` — no manual `certbot` setup, no renewal cron, it handles renewal ~30 days before expiry.

**Verify it's up:**
```bash
curl https://api.datalia.app/health
# → {"status":"ok","dependencies":{"mariadb":"ok"}}
```

If you see a TLS error, wait 30 seconds and retry (Caddy is still
provisioning the cert). If the error persists, check DNS actually
points to this server for **both** hosts:
`dig +short api.datalia.app` and `dig +short app.datalia.app`.

---

## Part 6 — Update the social-platform dev portals

Each provider needs to know where to send users back after OAuth, and TikTok additionally needs to verify domain ownership.

### Meta (developers.facebook.com)
On your Datalia Meta app:
- **App Settings → Basic → App Domains:** add `api.datalia.app`
- **Use cases → Customize (Auth & account creation):** under **Valid OAuth Redirect URIs** add `https://api.datalia.app/oauth/meta/callback`
- **Site URL** (Basic settings): `https://api.datalia.app`

### TikTok (developers.tiktok.com)
On your Datalia TikTok app:
- **App details → URL properties → Redirect URI:** add `https://api.datalia.app/oauth/tiktok/callback`
- **Terms of Service URL:** `https://api.datalia.app/terms`
- **Privacy Policy URL:** `https://api.datalia.app/privacy`
- **Domain verification:** click **Add → Verify URL prefix** with `https://api.datalia.app/`. TikTok shows you a token-named `.txt` filename like `tiktok<token>.txt`. **Copy the token portion** (the part after `tiktok` and before `.txt`) and put it in `.env.production` as `TIKTOK_DOMAIN_VERIFY=<token>`. Then restart the backend:
  ```bash
  docker compose -f docker-compose.prod.yml --env-file .env.production up -d
  ```
  Back on the TikTok portal click **Verify** — the backend serves the file automatically.

### LinkedIn (optional, when you have an app)
- **Auth tab → Authorized redirect URLs:** add `https://api.datalia.app/oauth/linkedin/callback`

### LTX-2 video generation (recommended — free signup)

The Automation module can produce real LTX-2 videos when wired up. Free tier:

1. Sign up at [console.ltx.video](https://console.ltx.video) — no credit card needed, you get 100 free credits on creation.
2. Click **API Keys → Create key**, copy the `ltxv_…` token.
3. Paste into `.env.production`:
   ```env
   LTX_API_KEY=ltxv_<your-key>
   LTX_API_BASE_URL=https://api.ltx.video/v1
   LTX_VIDEO_MODEL=ltx-2-3-pro
   ```
4. Restart: `docker compose -f docker-compose.prod.yml --env-file .env.production up -d`.

Without `LTX_API_KEY`, video generation falls back to the bundled ffmpeg Ken Burns renderer (animates a generated still). That works forever for €0 but looks dated — use it as the safety net, not the primary.

When LTX runs out of credits or is overloaded, the backend **automatically falls back to ffmpeg** for that single job so the user always gets a video — see `attempts` field on the job record for the chain.

---

## Part 7 — Verify the frontend

The frontend is built by `docker-compose.prod.yml` and served by Caddy at `https://app.datalia.app` using `FRONTEND_DOMAIN`. No separate `npm install`, pm2 process, or exposed `:3000` port is needed.

```bash
curl -I https://app.datalia.app
# → HTTP/2 200
```

> ℹ️ **Browser auth uses the JWT session cookie, not a baked-in token.** The
> frontend does **not** read `BACKEND_AUTH_TOKEN`, and there is no
> `NEXT_PUBLIC_BACKEND_AUTH_TOKEN` in the bundle. After `/auth/login` the browser
> holds an HttpOnly `SameSite=Lax` session cookie; that is what authenticates
> dashboard requests. `BACKEND_AUTH_TOKEN` is **server-to-server only** (e.g. the
> Telegram webhook caller) and must **never** be exposed to the browser — keeping
> it out of any `NEXT_PUBLIC_*` var is a hard security requirement, not a nicety.

---

## Part 8 — Smoke-test the deploy

Open the dashboard, register the first admin user, then sign in. Registration closes automatically after the first local user exists.

1. **Settings → Social connections** → Connect Facebook. You should land on Meta's OAuth screen and come back to the app with both a Facebook Page + Instagram Business target listed. ✅
2. **Settings → Social connections** → Connect TikTok. Same flow. ✅
3. **Settings → Telegram Validation Bot** → click **Send test message**. Your Telegram chat should receive a "Datalia bot test message". ✅
4. **Creation & Editor** → write a quick test post, hit Publish to Facebook. The post should land on the Page within seconds. ✅
5. **Automation** → create a rule firing 2 minutes from now with a 5-minute lead, Facebook as the platform. After ~60s a validation card arrives in Telegram. Tap **Approve** — at the original fire time the post publishes. ✅

If everything above works, the deploy is real.

---

## Operations cheat sheet

```bash
# tail logs
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f caption-api

# backend-only env change (e.g. an API key, a Telegram token) — no rebuild
docker compose -f docker-compose.prod.yml --env-file .env.production up -d

# changing API_DOMAIN or FRONTEND_DOMAIN — REBUILD REQUIRED
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# rebuild backend + frontend after a code pull
git -C ~/datalia pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

### Updating without resetting users/data

All login users + app state live in MariaDB's `mariadb-data` volume. The backend
**never silently starts a fresh DB** — `init_db` connects to MariaDB or refuses
to boot — so **if users "reset", that volume was replaced.** `up -d --build`
keeps named volumes, so the cause is one of two deploy traps:

1. **The volume got a new name.** Compose names volumes `<project>_mariadb-data`.
   If the Compose **project name** changes between deploys, a *new, empty* volume
   is created and the old one (with your users) is orphaned — still on disk,
   just not attached. The compose pins `name: datalia`, but a manager like
   **Dokploy can override the project name** with its own app id; if the app is
   deleted + recreated to deploy, the name changes. Check with
   `docker volume ls | grep mariadb` — more than one `*_mariadb-data` means this
   happened (your users are in the older one).
2. **Secrets were regenerated.** `MARIADB_PASSWORD` is only applied on *first*
   volume init. If a deploy regenerates it (e.g. `gen-secrets.sh` ran again
   because `.env.production` wasn't persisted), it no longer matches the existing
   DB → the backend can't connect and crashes; wiping the volume to "fix" the
   crash is what actually loses the users.

**Rules for safe updates:**
- A code update only needs the app images rebuilt — never tear down the DB:
  `... up -d --build caption-api frontend`. **Never** `down -v` or
  `docker volume prune` as part of a deploy.
- Set secrets **once** in Dokploy's persistent env panel (especially
  `MARIADB_PASSWORD` / `MARIADB_ROOT_PASSWORD` / `JWT_SECRET`); don't re-run
  `gen-secrets.sh` against an initialised DB.
- Keep the Dokploy app/stack **stable** — deploy by rebuilding it, not by
  deleting + recreating it, so the project (and volume) name stays put.
- **Best fix — make the data volumes immune to project-name churn.** Pin them to
  an explicit, project-independent name (or mark `external`) so every deploy
  attaches the *same* volume. Set the name to your CURRENT volume so no data
  moves (verify the name first with `docker volume ls`):
  ```yaml
  volumes:
    mariadb-data:
      name: datalia_mariadb-data      # your existing volume
    caption-content:
      name: datalia_caption-content
  ```
- Already lost them? The old volume is usually still on disk — copy it back:
  `docker run --rm -v <OLD_vol>:/from -v <NEW_vol>:/to alpine sh -c 'cp -a /from/. /to/'`

> ⚠️ **`up -d` is NOT enough for domain changes.** The frontend bakes
> `NEXT_PUBLIC_API_BASE_URL` (derived from `API_DOMAIN`) into the static bundle at
> **build** time — it is a build arg, not a runtime env var. So changing
> `API_DOMAIN` or `FRONTEND_DOMAIN` requires `up -d --build` to rebuild the
> frontend image; a plain `up -d` will keep serving the old API URL. Backend-only
> env changes (API keys, tokens, AI models) take effect with a plain `up -d`
> because the backend reads them at runtime.

---

## TikTok app review (when you're ready to ship)

TikTok requires a screen recording of your app to approve `video.publish`. Your recording **must** show:

1. **Login** — click "Connect TikTok", authorize, return to the app.
2. **Privacy selector** — open the dropdown and choose between Public / Friends / Private.
3. **Disclosure checkboxes** — tick both "Promote third-party brand" and "Promote yourself".
4. **Music consent** — tick "My content doesn't use copyrighted music".
5. **Publish** — hit Publish, then open the real TikTok app to show the post appeared.

**Do not:**
- Add fake watermarks/logos to the demo
- Call the app a "cross-posting" tool — TikTok wants original-creation tools
- Say it's "internal use only"

---

## Common gotchas

- **TLS error from your domain right after starting Caddy.** First-cert provisioning takes 20-40s. Wait and retry.
- **`Meta 100: Authorization Error subcode 33` on Instagram carousels.** Should not happen on a real domain. If you see it on `api.datalia.app`, check the Meta app permissions for `instagram_basic` + `instagram_content_publish`, and confirm the API hostname is reachable from Meta's IPs (no firewall block on `facebookexternalhit/1.1` user agents).
- **TikTok `access_token_invalid` returned 24h after a successful connect.** The refresh-token flow handles this automatically. If publishing still fails after refresh, reconnect TikTok from Settings.
- **Telegram approve doesn't publish.** Check the post's status in the calendar — if it says `scheduled` but isn't firing, the scheduler is waiting for the scheduled time. Check the container logs for `[scheduler]` lines.
- **Automation rule fires but no Telegram card arrives.** Settings → Telegram section → confirm all three status dots are green. If the bot token dot is red, `TELEGRAM_BOT_TOKEN` is missing/wrong in `.env.production`. Also verify the webhook registered successfully (Part 3.3).

---

## Running 24/7 in production (Dokploy)

The stack is built to run unattended. Three things matter for that:

1. **Always-on, single backend instance.** The scheduler, automation worker and
   video-job workers run **in-process** inside `caption-api` (started in the app
   lifespan), so scheduled posts only fire while that container is up.
   `restart: always` (in `docker-compose.prod.yml`) covers crashes/reboots.
   **Keep `caption-api` at exactly one replica** — scaling it horizontally would
   run the loops N times and double-publish. (Don't enable Dokploy "replicas" or
   rolling/overlapping deploys for this service.)
2. **Persistent media volume.** Uploads AND AI-generated media live on the
   `caption-content` volume at `CONTENT_DIR=/home/app/content` (per workspace
   under `content/ws/{id}/` and `content/ws/{id}/generated/`). It survives
   redeploys — don't deploy with an ephemeral/empty content dir or generated
   media vanishes on restart.
3. **Upload size at the proxy.** The app upload limit is **500 MB** (frontend +
   backend). The bundled Caddy is set to `request_body max_size 512MB` to match.
   **If Dokploy fronts the stack with its own Traefik**, make sure that proxy
   also allows ≥500 MB bodies (Traefik defaults to unlimited, so usually fine —
   but if you added a `buffering` middleware, raise its `maxRequestBodyBytes`).

Public URLs (`PUBLIC_BASE_URL` / `OAUTH_REDIRECT_BASE`) are already set to
`https://${API_DOMAIN}` so generated-media URLs and OAuth callbacks resolve on
the prod domain, not localhost.

## What gets persisted

State is split across **two** named volumes — back both up:

### `caption-content` (media only)
- Uploaded + AI-generated media (`content/`, per-workspace under
  `content/ws/{id}/` incl. `content/ws/{id}/generated/`)

> Posts, automation rules, OAuth tokens, runtime API keys, bell-feed messages,
> cost logs and video jobs **no longer live here as JSON** — they're migrated
> into MariaDB on startup (`migrate_legacy_state()`) and the DB is canonical.
> See the `mariadb-data` section below.

### `mariadb-data` (auth + all structured state)
- `users` table — bcrypt password hashes for everyone who can log in
- doc table — posts, automation rules, OAuth tokens, runtime API keys,
  bell-feed messages, cost logs, video jobs (all migrated out of the old JSON
  files; the DB is canonical). The `mariadb-dump` below captures all of it.

Both volumes survive `docker compose down`. They're only removed with `docker volume rm`. Back them up periodically.

> **Volume names are project-prefixed.** Compose prefixes every named volume with
> the project name, so the real volume is `<project>_caption-content`, not bare
> `caption-content`. The project name defaults to the directory the compose file
> lives in (`infra` → `infra_caption-content`) unless you set
> `COMPOSE_PROJECT_NAME` or a top-level `name:` in the compose file. The commands
> below resolve the real name automatically instead of hardcoding a prefix —
> run them from `~/datalia/infra`:

```bash
cd ~/datalia/infra
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.production"

# Resolve the actual (project-prefixed) caption-content volume name.
# Matches e.g. infra_caption-content (or datalia_caption-content if you set a
# project name). Confirm the match with: docker volume ls
CONTENT_VOL=$(docker volume ls -q | grep -E '_caption-content$' | head -n1)
echo "Backing up volume: $CONTENT_VOL"

# App state — media files
docker run --rm -v "$CONTENT_VOL":/data -v "$PWD":/backup alpine \
  tar czf "/backup/datalia-content-$(date +%F).tgz" -C /data .

# MariaDB (users table + per-user app state).
# Run mariadb-dump INSIDE the container so it reads the DB credentials from the
# container's own environment — the host shell never has $MARIADB_* exported, so
# referencing them on the host would dump with empty credentials and fail.
$COMPOSE exec -T mariadb sh -c \
  'exec mariadb-dump -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE"' \
  > "datalia-users-$(date +%F).sql"
```

> If you prefer to drive the dump from the host shell instead of inside the
> container, source the env file first so the variables actually exist:
> ```bash
> set -a; source ~/datalia/infra/.env.production; set +a
> $COMPOSE exec -T mariadb \
>   mariadb-dump -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE" \
>   > "datalia-users-$(date +%F).sql"
> ```
> (`set -a` exports everything sourced so the `$MARIADB_*` refs resolve; without
> it, `source` only sets shell-local vars and the dump runs with empty flags.)

> **Using managed MariaDB/MySQL instead?** Set `DATABASE_URL=mysql://...` (or
> `mariadb://...`) in `.env.production` and skip the embedded mariadb container —
> the API auto-detects the URL and uses it. The dev docker-compose keeps the
> embedded container for local convenience.
