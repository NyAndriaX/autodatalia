# Datalia Deployment Guide

This is the **one** doc you need to put Datalia in production. Follow it
top to bottom, copy-paste the commands, and the app will be running on
your domain by the end.

> Throughout this guide `your-domain.com` and `api.your-domain.com`
> are placeholders. Replace them with the real domain you own everywhere
> they appear (env vars, dev-portal URLs, frontend config).

---

## Before you start

You need:

- [ ] A **Linux server** with a public IP. ~$5–10/mo Hetzner CX22, DigitalOcean droplet, Vultr, Fly.io, etc. Ubuntu 22.04+ is the tested baseline. Minimum specs: 2 vCPU, 4 GB RAM, 40 GB disk.
- [ ] A **domain name** with DNS you can edit. The convention used here is `api.your-domain.com` for the backend and `your-domain.com` for the dashboard. Both can live on the same server unless you split them.
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
On your DNS host (Cloudflare / Namecheap / etc.) create an **A record**:

| Name | Type | Value |
|---|---|---|
| `api` | A | `<your server's public IP>` |

Wait 1–5 min for propagation. Verify with `dig api.your-domain.com` — it should return your server's IP.

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

Run these once and save the output somewhere safe:

```bash
echo "BACKEND_AUTH_TOKEN=$(openssl rand -hex 32)"
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32)"
```

You'll paste all three into the env file in Part 4.

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
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://api.your-domain.com/telegram/webhook&secret_token=<SECRET>"
```

You should get back `{"ok":true,"result":true,"description":"Webhook was set"}`. From Part 5 onward the backend handles webhook events automatically.

---

## Part 4 — Configure the app

Still in `~/datalia/infra` on the server:

```bash
cp .env.production.example .env.production
nano .env.production
```

Fill in **every line that has an `=` followed by nothing**. The minimum required to boot:

| Variable | What to put |
|---|---|
| `API_DOMAIN` | Your bare domain — `api.your-domain.com` (no `https://`, no path) |
| `FRONTEND_DOMAIN` | Dashboard domain: `your-domain.com` or `app.your-domain.com` (no `https://`, no path) |
| `CORS_ALLOW_ORIGINS` | Frontend URL(s), comma-separated: `https://your-domain.com` |
| `BACKEND_AUTH_TOKEN` | The hex from Part 2 |
| `JWT_SECRET` | The hex from Part 2 |
| `AI_API_KEY` | Your OpenRouter key |
| `META_APP_ID` + `META_APP_SECRET` | From developers.facebook.com |
| `TIKTOK_CLIENT_KEY` + `TIKTOK_CLIENT_SECRET` | From developers.tiktok.com |
| `TIKTOK_DOMAIN_VERIFY` | The token TikTok gives you when verifying the domain (Part 6) |
| `TELEGRAM_BOT_TOKEN` | From Part 3 |
| `TELEGRAM_DEFAULT_CHAT_ID` | From Part 3 |
| `TELEGRAM_WEBHOOK_SECRET` | The hex from Part 2 |

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
curl https://api.your-domain.com/health
# → {"status":"ok","dependencies":{"postgres":"ok"}}
```

If you see a TLS error, wait 30 seconds and retry (Caddy is still
provisioning the cert). If the error persists, check DNS actually
points to this server: `dig api.your-domain.com`.

---

## Part 6 — Update the social-platform dev portals

Each provider needs to know where to send users back after OAuth, and TikTok additionally needs to verify domain ownership.

### Meta (developers.facebook.com)
On your Datalia Meta app:
- **App Settings → Basic → App Domains:** add `api.your-domain.com`
- **Use cases → Customize (Auth & account creation):** under **Valid OAuth Redirect URIs** add `https://api.your-domain.com/oauth/meta/callback`
- **Site URL** (Basic settings): `https://api.your-domain.com`

### TikTok (developers.tiktok.com)
On your Datalia TikTok app:
- **App details → URL properties → Redirect URI:** add `https://api.your-domain.com/oauth/tiktok/callback`
- **Terms of Service URL:** `https://api.your-domain.com/terms`
- **Privacy Policy URL:** `https://api.your-domain.com/privacy`
- **Domain verification:** click **Add → Verify URL prefix** with `https://api.your-domain.com/`. TikTok shows you a token-named `.txt` filename like `tiktok<token>.txt`. **Copy the token portion** (the part after `tiktok` and before `.txt`) and put it in `.env.production` as `TIKTOK_DOMAIN_VERIFY=<token>`. Then restart the backend:
  ```bash
  docker compose -f docker-compose.prod.yml --env-file .env.production up -d
  ```
  Back on the TikTok portal click **Verify** — the backend serves the file automatically.

### LinkedIn (optional, when you have an app)
- **Auth tab → Authorized redirect URLs:** add `https://api.your-domain.com/oauth/linkedin/callback`

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

The frontend is built by `docker-compose.prod.yml` and served by Caddy at `https://your-domain.com` using `FRONTEND_DOMAIN`. No separate `npm install`, pm2 process, or exposed `:3000` port is needed.

```bash
curl -I https://your-domain.com
# → HTTP/2 200
```

> ⚠️ `NEXT_PUBLIC_BACKEND_AUTH_TOKEN` ships to the browser. Fine for an internal-only tool with a known user list; if the dashboard becomes public-facing, switch to a proxy auth flow.

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

# restart after env change (no rebuild needed)
docker compose -f docker-compose.prod.yml --env-file .env.production up -d

# rebuild after code pull
git -C ~/datalia pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# rebuild backend + frontend after a code pull
git -C ~/datalia pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

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
- **`Meta 100: Authorization Error subcode 33` on Instagram carousels.** Should not happen on a real domain. If you see it on `api.your-domain.com`, check the Meta app permissions for `instagram_basic` + `instagram_content_publish`, and confirm the API hostname is reachable from Meta's IPs (no firewall block on `facebookexternalhit/1.1` user agents).
- **TikTok `access_token_invalid` returned 24h after a successful connect.** The refresh-token flow handles this automatically. If publishing still fails after refresh, reconnect TikTok from Settings.
- **Telegram approve doesn't publish.** Check the post's status in the calendar — if it says `scheduled` but isn't firing, the scheduler is waiting for the scheduled time. Check the container logs for `[scheduler]` lines.
- **Automation rule fires but no Telegram card arrives.** Settings → Telegram section → confirm all three status dots are green. If the bot token dot is red, `TELEGRAM_BOT_TOKEN` is missing/wrong in `.env.production`. Also verify the webhook registered successfully (Part 3.3).

---

## What gets persisted

State is split across **two** named volumes — back both up:

### `caption-content` (app state)
- `posts.json` — every post (draft, scheduled, published, automation candidates)
- `automation_rules.json` — automation rules
- `messages.json` — bell-menu activity feed
- `.oauth_tokens*.json` — provider access tokens
- `cost_logs.json` — per-call AI / media cost rows
- `video_jobs.json` — LTX video generation queue
- Uploaded + AI-generated media

### `postgres-data` (auth)
- `users` table — bcrypt password hashes for everyone who can log in

Both volumes survive `docker compose down`. They're only removed with `docker volume rm`. Back them up periodically:

```bash
# App state (JSON + media)
docker run --rm -v datalia_caption-content:/data -v "$PWD":/backup alpine \
  tar czf /backup/datalia-content-$(date +%F).tgz -C /data .

# Postgres (users table + future schema)
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > "datalia-users-$(date +%F).sql"
```

> **Using managed Postgres instead?** Set `DATABASE_URL=postgres://...` in
> `.env.production` and skip the embedded postgres container — the API
> auto-detects the URL and uses it. The dev docker-compose keeps the
> embedded container for local convenience.
