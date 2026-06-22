# Project State

Last updated: 2026-06-22

This is the short source-of-truth snapshot for the current branch.

## Stack

- Frontend: Next.js 16
- Backend: FastAPI
- Database: MariaDB
- Local runtime: `infra/docker-compose.yml`
- Production runtime: `infra/docker-compose.prod.yml` on Dokploy + Traefik

## Product model

- Users register with email + password.
- Each new user gets a personal workspace automatically.
- Users can create more workspaces.
- Users can invite existing Datalia users into a shared workspace.
- Data, notifications, settings, social connections, and publishing state are scoped by active workspace.

## Social and publishing

- Direct provider support exists for Facebook, Instagram, TikTok, and LinkedIn.
- Zernio support exists as an optional workspace-level connection layer.
- Manual publish exists.
- Scheduling exists.
- Automation exists.
- Telegram validation exists for automated approval flows.

## Persistence

MariaDB stores:

- users
- workspaces and memberships
- posts
- automation rules
- OAuth tokens
- runtime settings and API keys
- notifications
- cost logs
- video jobs

Docker volume stores:

- uploaded media
- generated media

## Local URLs

- frontend: `http://localhost:3005`
- backend: `http://localhost:8000`

## Production rules

- use Dokploy, not a hand-rolled reverse proxy
- use `infra/docker-compose.prod.yml`
- keep one backend replica only
- keep the pinned volumes unchanged
- rebuild after domain changes

## Known operator-sensitive areas

- Social OAuth needs real public HTTPS callback URLs.
- Scheduled and automated posting depend on the backend worker being up.
- Telegram validation depends on `TELEGRAM_BOT_TOKEN`, `TELEGRAM_DEFAULT_CHAT_ID`, and `TELEGRAM_WEBHOOK_SECRET`.
- Zernio behavior depends on the workspace key configured in Settings, or an optional global default env key.

## Main docs

- [README.md](README.md)
- [DEPLOY.md](DEPLOY.md)
- [infra/README.md](infra/README.md)
