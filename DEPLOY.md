# Datalia Deployment

This is the short production path.

## 1. What production uses

- Dokploy
- `infra/docker-compose.prod.yml`
- Dokploy's built-in Traefik
- MariaDB in Docker, with pinned named volumes
- one backend container only

Do not add Caddy.
Do not expose host ports manually.
Do not scale the backend to multiple replicas.

## 2. Requirements

You need:

- a Linux server with Dokploy installed
- a Git repo connection in Dokploy
- two DNS records pointing to the server
  - `api.yourdomain.com`
  - `app.yourdomain.com`

## 3. Dokploy setup

In Dokploy:

1. Create a new Compose service.
2. Point it to:

```text
infra/docker-compose.prod.yml
```

3. Add these domains:

- `api.yourdomain.com` -> service `caption-api` -> port `8000`
- `app.yourdomain.com` -> service `frontend` -> port `3000`

## 4. Required env

Set these in Dokploy before first deploy:

```env
ENV=production
API_DOMAIN=api.yourdomain.com
FRONTEND_DOMAIN=app.yourdomain.com
CORS_ALLOW_ORIGINS=https://app.yourdomain.com

JWT_SECRET=<strong random secret>
BACKEND_AUTH_TOKEN=<strong random secret>
MARIADB_PASSWORD=<strong random secret>
MARIADB_ROOT_PASSWORD=<strong random secret>
TELEGRAM_WEBHOOK_SECRET=<strong random secret>

AI_API_KEY=<your ai key>

META_APP_ID=<meta app id>
META_APP_SECRET=<meta app secret>

TIKTOK_CLIENT_KEY=<tiktok client key>
TIKTOK_CLIENT_SECRET=<tiktok client secret>
TIKTOK_DOMAIN_VERIFY=<tiktok verification token if used>

TELEGRAM_BOT_TOKEN=<telegram bot token>
TELEGRAM_DEFAULT_CHAT_ID=<telegram chat id>
```

Optional:

```env
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LTX_API_KEY=
ZERNIO_API_KEY=
DATABASE_URL=
```

Notes:

- `ZERNIO_API_KEY` is optional. If set, a workspace can use Zernio as its shared social connection layer.
- `DATABASE_URL` is optional. Leave it empty to use the bundled MariaDB container.
- Keep `ALLOW_OPEN_AUTH=false` in production.
- After onboarding, set `ALLOW_OPEN_REGISTRATION=false` if you want to close signup.

## 5. Deploy

Deploy from Dokploy UI.

After deploy, verify:

```bash
curl https://api.yourdomain.com/health
curl -I https://app.yourdomain.com
```

Expected:

- backend health returns OK
- frontend returns `200`

## 6. Social callback URLs

Use these exact callback URLs in provider dashboards:

- Meta: `https://api.yourdomain.com/oauth/meta/callback`
- TikTok: `https://api.yourdomain.com/oauth/tiktok/callback`
- LinkedIn: `https://api.yourdomain.com/oauth/linkedin/callback`

Also set:

- Terms URL: `https://api.yourdomain.com/terms`
- Privacy URL: `https://api.yourdomain.com/privacy`

## 7. Telegram webhook

Register the webhook once:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://api.yourdomain.com/telegram/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

## 8. Smoke test

Test this after deploy:

1. Open `https://app.yourdomain.com`
2. Register and sign in
3. Create a workspace
4. Invite another user to that workspace
5. Connect a social account in Settings
6. If using Zernio, save the key in the workspace and connect one platform
7. Create and publish a manual post
8. Schedule a post
9. Create an automation rule
10. Confirm Telegram approval flow works before auto-publish

## 9. Important operating rules

- Keep exactly one `caption-api` replica.
- Never delete and recreate the Dokploy service just to redeploy.
- Never run `down -v` on production data.
- Do not rename these volumes:
  - `datalia_mariadb-data`
  - `datalia_caption-content`
- If you change `API_DOMAIN` or `FRONTEND_DOMAIN`, rebuild the frontend.

## 10. CEO version

If you want the shortest possible explanation:

1. Put the repo in Dokploy as a Compose app.
2. Use `infra/docker-compose.prod.yml`.
3. Point `api.domain.com` to backend port `8000`.
4. Point `app.domain.com` to frontend port `3000`.
5. Fill env secrets and API keys.
6. Deploy.
7. Test login, one manual publish, one scheduled post, one Telegram validation flow.
