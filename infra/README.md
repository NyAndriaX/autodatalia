# DATALIA Infra - Orchestration & Deployment

Docker Compose configuration for running the FastAPI backend locally and in
production.

The active runtime is direct frontend -> backend. n8n is not part of the current
compose stack.

## Layout

```text
infra/
|-- docker-compose.yml           # Local dev: caption-api only
|-- docker-compose.prod.yml      # Production: Caddy + caption-api
|-- .env.example                 # Safe local env template
|-- .env                         # Local secrets, git-ignored
|-- .env.production.example      # Safe production env template
`-- caddy/
    `-- Caddyfile                # HTTPS reverse proxy for production API
```

The local `caption-api` service builds from `../backend` and bind-mounts
`../backend/content` to `/app/content`.

## Local Backend

```bash
docker compose -f infra/docker-compose.yml up -d --build caption-api
```

Service URL:

| Service | URL |
|---|---|
| caption-api | http://localhost:8000 |

Useful commands:

```bash
docker compose -f infra/docker-compose.yml restart caption-api
docker compose -f infra/docker-compose.yml logs -f caption-api
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
| `BACKEND_AUTH_TOKEN` | empty | Bearer token gate for mutating routes |
| `OAUTH_REDIRECT_BASE` | `http://localhost:8000` | Public HTTPS callback base for OAuth |
| `PUBLIC_BASE_URL` | request base URL | Optional public media URL override |
| provider secrets | empty | Meta, TikTok, LinkedIn, Google credentials |

`BACKEND_AUTH_TOKEN` should be set before any public deployment.

## Public HTTPS For OAuth

Meta and TikTok require HTTPS callbacks. For local OAuth testing, point a public
HTTPS tunnel at the backend and set:

```env
OAUTH_REDIRECT_BASE=https://<public-host>
PUBLIC_BASE_URL=https://<public-host>
```

The same host must serve uploaded media under `/content/*` so social platforms
can fetch media during publish.

## Production Backend

Production uses:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.production up -d --build
```

The production compose runs:

| Service | Purpose |
|---|---|
| `caddy` | HTTPS reverse proxy and Let's Encrypt certificate management |
| `caption-api` | FastAPI backend, exposed only on the Docker network |

Persistent data lives in the `caption-content` named volume. It holds uploads,
cropped media, posts, messages, AI caches, and OAuth tokens.

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
