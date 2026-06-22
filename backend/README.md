# Backend

FastAPI backend for Datalia.

It handles:

- auth
- workspaces and roles
- AI text/media generation
- media upload and serving
- social OAuth
- publishing
- scheduling
- automation
- Telegram validation
- notifications

## Stack

- FastAPI
- PyMySQL / MariaDB
- Docker

## Current behavior

- Users sign in with email + password.
- Each user gets a personal workspace at registration.
- Users can join shared workspaces through invites.
- Posts, tokens, settings, notifications, and automation state are scoped by active workspace.
- Social connections are workspace-scoped.
- Zernio is optional and can be used as a workspace-level social connection layer.

## Main modules

- `app/main.py` — app startup and router registration
- `app/auth.py` — register, login, logout, account actions, invite accept
- `app/authz.py` — workspace and permission resolution
- `app/workspaces.py` — workspace, role, member, invitation logic
- `app/workspaces_routes.py` — Team & Access endpoints
- `app/routes.py` — posts, media, messages, settings-related API
- `app/oauth.py` — direct provider OAuth routes
- `app/publish.py` — publish fan-out
- `app/zernio.py` — Zernio integration
- `app/scheduler.py` — scheduled publishing loop
- `app/automation_worker.py` — automation generation and approval flow
- `app/telegram_validation.py` — Telegram webhook and approval actions
- `app/services.py` — AI text generation and related helpers
- `app/media_generation.py` — AI image/video generation
- `app/db.py` — MariaDB connection and document storage helpers

## Main endpoints

- `GET /health`
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /workspace`
- `GET /workspaces`
- `POST /workspaces`
- `POST /workspace/switch`
- `GET /workspace/members`
- `GET /workspace/roles`
- `GET /oauth/connections`
- `POST /generate`
- `POST /upload`
- `GET/POST/PATCH/DELETE /posts`
- `GET/POST/PATCH/DELETE /automation-rules`
- `POST /publish`
- `POST /telegram/webhook`
- `GET /messages`

## Local run

From repo root:

```bash
docker compose -f infra/docker-compose.yml up -d --build caption-api
```

Backend URL:

- `http://localhost:8000`

## Tests

```bash
docker compose -f infra/docker-compose.yml exec -T caption-api python -m pytest tests -q
```

## Production notes

- production compose is `infra/docker-compose.prod.yml`
- production runtime is Dokploy + Traefik
- keep one backend replica only
- MariaDB is the source of truth for structured state
- media files stay on the content volume

See:

- [../README.md](../README.md)
- [../DEPLOY.md](../DEPLOY.md)
- [../PROJECT_STATE.md](../PROJECT_STATE.md)
