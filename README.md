# Datalia

Datalia is a multi-workspace marketing automation app.

Teams can:
- create posts with AI
- upload or generate media
- publish to Facebook, Instagram, TikTok, and LinkedIn
- schedule posts
- run automation rules
- require Telegram validation before automated posts go live
- share one workspace, one set of connected accounts, and one Zernio setup

## Current State

- Backend: FastAPI + MariaDB
- Frontend: Next.js 16
- Local run: Docker Compose
- Production run: Dokploy + Traefik
- Storage: MariaDB for users, workspaces, posts, settings, tokens, notifications; Docker volume for media files

## How the app works now

- Every new user can register with email + password.
- Every new user gets a personal workspace automatically.
- Users can create additional workspaces.
- Users can invite other existing users into a shared workspace.
- Data is scoped by active workspace, not by browser session alone.
- Social connections and runtime settings are workspace-scoped.
- Zernio is optional and can be configured per workspace.
- Automation and scheduled publishing run in the backend worker loop.
- Telegram validation is used for automation approval/rejection flows.

## Main Folders

- [frontend](frontend/) — Next.js dashboard
- [backend](backend/) — FastAPI API, publishing, AI, automation, auth
- [infra](infra/) — Docker Compose files and env templates
- [DEPLOY.md](DEPLOY.md) — production steps

## Local Run

Full local stack:

```bash
docker compose -f infra/docker-compose.yml up -d --build
```

URLs:

- Frontend: `http://localhost:3005`
- Backend: `http://localhost:8000`

Backend tests:

Runs against a dedicated `datalia_test` database (the suite wipes every table,
so it refuses to run against the dev `datalia` database):

```powershell
./backend/run-tests.ps1
```

## Production Summary

Production uses:

- `infra/docker-compose.prod.yml`
- Dokploy Compose service
- Dokploy/Traefik HTTPS routing
- two domains:
  - frontend: `app.yourdomain.com`
  - backend: `api.yourdomain.com`

Important production rules:

- do not run multiple backend replicas
- do not delete the Dokploy app to redeploy
- do not change volume names
- rebuild after domain changes

See [DEPLOY.md](DEPLOY.md) for the exact production checklist.
