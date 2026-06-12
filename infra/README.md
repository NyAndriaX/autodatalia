# DATALIA Infra - Orchestration & Deployment

Docker Compose configuration for running the local full stack and the
production stack.

The active runtime is direct frontend -> backend. n8n is not part of the current
compose stack.

## Layout

```text
infra/
|-- docker-compose.yml           # Local dev: frontend + caption-api + mariadb
|-- docker-compose.prod.yml      # Production: Caddy + frontend + caption-api + mariadb
|-- .env.example                 # Safe local env template
|-- .env                         # Local secrets, git-ignored
|-- .env.production.example      # Safe production env template
`-- caddy/
    `-- Caddyfile                # HTTPS reverse proxy for production API + dashboard
```

The local stack builds the backend from `../backend`, serves the dashboard on
`http://localhost:3005`, the API on `http://localhost:8000`, and keeps app
state in the in-stack MariaDB container.

The local compose project is intentionally named `infra` so Docker Desktop's
Compose UI can start it reliably from the `infra/` folder. The MariaDB volume
name stays `datalia_mariadb_data` so existing local data is preserved.

## Local Stack

```bash
docker compose -f infra/docker-compose.yml up -d --build
```

Service URL:

| Service | URL |
|---|---|
| frontend | http://localhost:3005 |
| caption-api | http://localhost:8000 |

Useful commands:

```bash
docker compose -f infra/docker-compose.yml ps
docker compose -f infra/docker-compose.yml logs -f caption-api
docker compose -f infra/docker-compose.yml logs -f frontend
docker compose -f infra/docker-compose.yml exec -T caption-api python -m pytest /home/app/tests -q
```

Windows helper:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-local.ps1
```

Rebuild for code, dependency, or Dockerfile changes. A restart is enough for
most `infra/.env` changes, but force-recreate the service if the live container
still has stale environment values.

## Local Environment

Compose reads `infra/.env` automatically.

| Variable | Default | Purpose |
|---|---|---|
| `AI_API_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI-compatible provider endpoint |
| `AI_API_KEY` | empty | Provider API key |
| `AI_MODEL` | `google/gemini-2.0-flash-lite-001` | Default generation model |
| `AI_MODEL_FAST` | `AI_MODEL` | Cheap/fast model for low-risk tasks |
| `AI_MODEL_PREMIUM` | `AI_MODEL` | Reserved premium model |
| `AI_INCLUDE_IMAGES` | `false` | Whether AI calls include image bytes by default |
| `AI_DAILY_LIMIT` | `200` | Per-client daily non-cached AI call cap |
| `CORS_ALLOW_ORIGINS` | localhost frontend origins | Direct browser access allowlist |
| `BACKEND_AUTH_TOKEN` | empty | Optional shared bearer token for server-to-server calls |
| `ALLOW_OPEN_AUTH` | `true` local / `false` prod | Anonymous access switch; keep false on any public deployment |
| `OAUTH_REDIRECT_BASE` | `http://localhost:8000` | Public HTTPS callback base for OAuth |
| `PUBLIC_BASE_URL` | request base URL | Optional public media URL override |
| provider secrets | empty | Meta, TikTok, LinkedIn, Google credentials |

For any public deployment, keep `ALLOW_OPEN_AUTH=false`. Browser users should
authenticate through `/auth/login`; do not ship a shared backend token to the
frontend bundle.

If Telegram validation is enabled, set `TELEGRAM_WEBHOOK_SECRET`. The backend
now rejects webhook callbacks and validation submissions when the bot is on but
the secret is missing.

## Public HTTPS For OAuth

Meta and TikTok require HTTPS callbacks. For local OAuth testing, point a public
HTTPS tunnel at the backend and set:

```env
OAUTH_REDIRECT_BASE=https://<public-host>
PUBLIC_BASE_URL=https://<public-host>
```

The same host must serve uploaded media under `/content/*` so social platforms
can fetch media during publish.

## Production Stack

Production uses:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.production up -d --build
```

The production compose runs:

| Service | Purpose |
|---|---|
| `caddy` | HTTPS reverse proxy and Let's Encrypt certificate management |
| `caption-api` | FastAPI backend, exposed only on the Docker network |
| `frontend` | Next.js dashboard, exposed only through Caddy |

Set `API_DOMAIN` for the API host and `FRONTEND_DOMAIN` for the dashboard host
in `infra/.env.production`. Persistent media lives in the `caption-content`
named volume. App state and user accounts live in MariaDB.

## Backend Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness |
| `POST` | `/generate` | Prompt-driven content generation |
| `POST` | `/transform` | Quick AI actions |
| `POST` | `/upload` | Store image/video and return public URL |
| `GET/POST/PATCH/DELETE` | `/posts` | Calendar post persistence |
| `POST` | `/publish` | Publish to selected social targets |
| `GET` | `/oauth/{provider}/start` | Begin OAuth |
| `GET` | `/oauth/{provider}/callback` | OAuth callback |
| `GET` | `/oauth/connections` | Connected providers and publish targets |
| `GET` | `/content/*` | Static uploaded media |
