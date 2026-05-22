# DATALIA Backend — FastAPI Service

Python **FastAPI** service that backs the Datalia dashboard. Handles AI
generation, media uploads, calendar persistence, social OAuth, and
publishing fan-out to Meta (Facebook + Instagram), TikTok and LinkedIn.

Run via Docker Compose from [`../infra/`](../infra/) (recommended), or standalone.

## Project structure

```
backend/
├── Dockerfile
├── requirements.txt
├── content/                 # Uploaded media + JSON state (volume-mounted)
└── app/
    ├── main.py              # FastAPI entrypoint, CORS, /content mount, TikTok verify
    ├── config.py            # Env-loaded settings
    ├── auth.py              # Bearer-token dependency
    ├── models.py            # Pydantic request/response schemas
    ├── routes.py            # REST endpoints
    ├── services.py          # AI generation + image-desc cache + posts CRUD
    ├── oauth.py             # OAuth providers (meta/tiktok/linkedin/google)
    ├── publish.py           # Per-platform publish + spam guard
    ├── images.py            # Pillow center-crop per aspect ratio
    └── tunnel.py            # Cloudflare quick-tunnel helper (opt-in)
```

## API surface

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health check |
| POST | `/generate` | AI content generation |
| POST | `/transform` | AI quick actions (rewrite, shorten, hashtags…) |
| POST | `/upload` | Upload media to `content/`, returns public URL |
| GET / POST / PATCH / DELETE | `/posts` | Calendar post CRUD |
| POST | `/publish` | Fan-out to selected social targets |
| GET | `/oauth/{provider}/start` | Begin OAuth flow (returns authorize URL) |
| GET | `/oauth/{provider}/callback` | OAuth callback (posts message to opener) |
| GET | `/oauth/connections` | List connected providers + postable targets |
| GET | `/tiktok{token}.txt` | TikTok domain-verification file |
| - | `/content/*` | Static-mounted uploaded media |

Mutating routes require `Authorization: Bearer <BACKEND_AUTH_TOKEN>` when
that env var is set; leaving it empty disables the gate (open mode).

## Environment variables

Loaded from `infra/.env` when running under Docker Compose.

| Variable | Required | Purpose |
|---|---|---|
| `AI_API_BASE_URL` | yes | OpenAI-compatible endpoint (default OpenRouter) |
| `AI_API_KEY` | yes | Provider API key |
| `AI_MODEL` / `AI_MODEL_FAST` / `AI_MODEL_PREMIUM` | partial | Three-tier model routing |
| `AI_INCLUDE_IMAGES` | no | Send images for vision captioning |
| `AI_DAILY_LIMIT` | no | Per-client daily AI call cap |
| `CORS_ALLOW_ORIGINS` | no | Comma-separated allowed origins |
| `BACKEND_AUTH_TOKEN` | no | Empty = open mode; otherwise required on mutating routes |
| `OAUTH_REDIRECT_BASE` | for OAuth | Public HTTPS host receiving callbacks |
| `PUBLIC_BASE_URL` | no | Overrides URL used by `/upload` for media |
| `META_APP_ID` / `META_APP_SECRET` | for Meta | Facebook + Instagram |
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` / `TIKTOK_DOMAIN_VERIFY` | for TikTok | |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | for LinkedIn | |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | for Google sign-in | |
| `CONTENT_DIR` | no | Defaults to `/app/content` in the container |
| `TUNNEL_ENABLED` | no | Opt-in Cloudflare quick-tunnel at boot |

## Run standalone (without Docker)

```bash
cd backend
pip install -r requirements.txt
export AI_API_KEY=sk-or-v1-...
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Tests

```bash
cd backend
pytest
```

The frontend handles CORS via `CORS_ALLOW_ORIGINS` (defaults include
`http://localhost:3000`), so no Next.js rewrite proxy is required.
