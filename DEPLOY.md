# Datalia Deployment Guide

This is the **one** doc you need to put Datalia in production. Follow it
top to bottom, copy-paste the commands, and the app will be running on
your domain by the end. For the architecture rationale behind the
choices (why Docker, why Caddy, why JSON storage) see
[`plans/hosting.md`](plans/hosting.md).

---

## Before you start

You need:

- [ ] A **Linux server** with a public IP. ~$5–10/mo Hetzner CX22, DigitalOcean droplet, Vultr, Fly.io, etc. Ubuntu 22.04+ is the tested baseline. Minimum specs: 2 vCPU, 4 GB RAM, 40 GB disk.
- [ ] A **domain name** with DNS you can edit. Datalia uses `api.datalia.com` for the backend and `datalia.com` for the dashboard. Both will be on this same server unless you split them.
- [ ] **API keys / app credentials** ready to paste:
  - **OpenRouter** API key (`sk-or-v1-…`) — for AI generation
  - **Meta** app ID + secret — Facebook + Instagram OAuth
  - **TikTok** client key + secret — TikTok OAuth
  - **Telegram bot token** — content validation gate (see Part 3)
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
git clone https://github.com/joeyfrontend/DataliaAuto.git ~/datalia
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
| `API_DOMAIN` | Your bare domain — `api.datalia.com` (no `https://`, no path) |
| `CORS_ALLOW_ORIGINS` | Frontend URL(s), comma-separated: `https://datalia.com,https://www.datalia.com` |
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

## Part 5 — Start the backend

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

First build takes 2–4 min. Watch progress with:
```bash
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f
```

Caddy automatically provisions a Let's Encrypt certificate on the first request to your domain — no manual `certbot` setup, no renewal cron, it handles renewal ~30 days before expiry.

**Verify it's up:**
```bash
curl https://api.datalia.com/health
# → {"ok":true}
```

If you see a TLS error, wait 30 seconds and retry (Caddy is still
provisioning the cert). If the error persists, check DNS actually
points to this server: `dig api.datalia.com`.

---

## Part 6 — Update the social-platform dev portals

Each provider needs to know where to send users back after OAuth, and TikTok additionally needs to verify domain ownership.

### Meta (developers.facebook.com)
On your Datalia Meta app:
- **App Settings → Basic → App Domains:** add `api.datalia.com`
- **Use cases → Customize (Auth & account creation):** under **Valid OAuth Redirect URIs** add `https://api.datalia.com/oauth/meta/callback`
- **Site URL** (Basic settings): `https://api.datalia.com`

### TikTok (developers.tiktok.com)
On your Datalia TikTok app:
- **App details → URL properties → Redirect URI:** add `https://api.datalia.com/oauth/tiktok/callback`
- **Terms of Service URL:** `https://api.datalia.com/terms`
- **Privacy Policy URL:** `https://api.datalia.com/privacy`
- **Domain verification:** click **Add → Verify URL prefix** with `https://api.datalia.com/`. TikTok shows you a token-named `.txt` filename like `tiktok<token>.txt`. **Copy the token portion** (the part after `tiktok` and before `.txt`) and put it in `.env.production` as `TIKTOK_DOMAIN_VERIFY=<token>`. Then restart the backend:
  ```bash
  docker compose -f docker-compose.prod.yml --env-file .env.production up -d
  ```
  Back on the TikTok portal click **Verify** — the backend serves the file automatically.

### LinkedIn (optional, when you have an app)
- **Auth tab → Authorized redirect URLs:** add `https://api.datalia.com/oauth/linkedin/callback`

---

## Part 7 — Start the frontend

Still on the same server:

```bash
cd ~/datalia/frontend
npm install
```

Create the frontend env file:
```bash
cat > .env.local <<EOF
NEXT_PUBLIC_API_BASE_URL=https://api.datalia.com
NEXT_PUBLIC_BACKEND_AUTH_TOKEN=$(grep '^BACKEND_AUTH_TOKEN=' ~/datalia/infra/.env.production | cut -d= -f2-)
EOF
```

Build and start, kept alive by pm2:
```bash
npm run build
npx pm2 start npm --name datalia-frontend -- start -- -p 3000
npx pm2 save
npx pm2 startup     # follow the printed command so pm2 survives reboot
```

The dashboard is now on **http://server-ip:3000**. To expose it on a clean URL (e.g. `https://datalia.com`), either:

1. **Deploy frontend to Vercel** instead (point the Vercel project at this repo's `frontend/` dir, set `NEXT_PUBLIC_API_BASE_URL=https://api.datalia.com`, deploy). Simpler.
2. **Or add a second Caddy block** on the same server that reverse-proxies `https://datalia.com` to `localhost:3000`. See [`infra/caddy/Caddyfile`](infra/caddy/Caddyfile) and copy the existing block.

> ⚠️ `NEXT_PUBLIC_BACKEND_AUTH_TOKEN` ships to the browser. Fine for an internal-only tool with a known user list; if the dashboard becomes public-facing, switch to a proxy auth flow.

---

## Part 8 — Smoke-test the deploy

Open the dashboard, sign in (it bootstraps the first admin user on first registration), then:

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

# restart the frontend after a code pull
cd ~/datalia/frontend && git pull && npm install && npm run build
pm2 restart datalia-frontend
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
- **`Meta 100: Authorization Error subcode 33` on Instagram carousels.** Should not happen on a real domain — the previous occurrences were caused by ngrok's free-tier interstitial. If you see it on `api.datalia.com`, check the Meta app permissions for `instagram_basic` + `instagram_content_publish`.
- **TikTok `access_token_invalid` returned 24h after a successful connect.** The refresh-token flow handles this automatically. If publishing still fails after refresh, reconnect TikTok from Settings.
- **Telegram approve doesn't publish.** Check the post's status in the calendar — if it says `scheduled` but isn't firing, the scheduler is waiting for the scheduled time. Check the container logs for `[scheduler]` lines.
- **Automation rule fires but no Telegram card arrives.** Settings → Telegram section → confirm all three status dots are green. If the bot token dot is red, `TELEGRAM_BOT_TOKEN` is missing/wrong in `.env.production`. Also verify the webhook registered successfully (Part 3.3).

---

## What gets persisted

The `caption-content` Docker named volume holds:
- `posts.json` — every post (draft, scheduled, published, automation candidates)
- `automation_rules.json` — automation rules
- `messages.json` — bell-menu activity feed
- `.oauth_tokens*.json` — provider access tokens
- `users.db` — SQLite of registered users
- Uploaded + AI-generated media

The volume survives `docker compose down`. It's only removed with `docker volume rm`. Back it up periodically:

```bash
docker run --rm -v datalia_caption-content:/data -v "$PWD":/backup alpine \
  tar czf /backup/datalia-content-$(date +%F).tgz -C /data .
```
