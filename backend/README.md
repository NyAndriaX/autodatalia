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
├── content/                  # Uploaded media + JSON state (volume-mounted)
└── app/
    ├── main.py               # FastAPI entrypoint, CORS, /content mount, TikTok verify
    ├── config.py             # Env-loaded settings
    ├── auth.py               # /auth/* routes + bearer-token dependency
    ├── db.py                 # MariaDB app store (auth + app state, see DATABASE_URL)
    ├── models.py             # Pydantic request/response schemas
    ├── routes.py             # Core REST endpoints
    ├── services.py           # AI generation + image-desc cache + posts CRUD
    ├── scheduler.py          # In-process async loop firing scheduled posts
    ├── oauth.py              # OAuth providers (meta/tiktok/linkedin/google)
    ├── publish.py            # Per-platform publish + spam guard
    ├── images.py             # Pillow center-crop per aspect ratio
    ├── media_generation.py   # /media/generate/{image,video}
    ├── telegram_validation.py # Telegram bot webhook + approval flow
    ├── legal.py              # /privacy + /terms HTML pages
    └── tunnel.py             # Cloudflare quick-tunnel helper (opt-in)
```

## API surface

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health check |
| GET | `/tunnel-status` | Cloudflare quick-tunnel URL (if `TUNNEL_ENABLED=true`) |
| POST | `/generate` | AI content generation |
| POST | `/transform` | AI quick actions (rewrite, shorten, hashtags…) |
| POST | `/captions/generate` | Batch caption generation over content items |
| GET | `/content-items` | Enumerate media in the content dir with descriptions |
| POST | `/upload` | Upload media to `content/`, returns public URL |
| DELETE | `/media/{path}` | Remove a previously-uploaded media file |
| GET | `/search` | Search media in the content directory |
| GET | `/messages` | Notification feed for the bell menu |
| GET / POST / PATCH / DELETE | `/posts` | Calendar post CRUD |
| POST | `/publish` | Fan-out to selected social targets |
| POST | `/media/generate/image` | AI image generation (external provider, auto-fallback to local poster on provider/quota failure) |
| POST | `/media/generate/video` | AI video generation (Ken Burns clip from generated image) |
| POST | `/auth/register`, `/auth/login` | Local user accounts (sets HttpOnly session cookie) |
| POST | `/auth/logout` | Clear the session cookie |
| GET | `/auth/me` | Current authenticated user |
| GET | `/oauth/status` | Per-provider connection state |
| GET | `/oauth/{provider}/start` | Begin OAuth flow (returns authorize URL) |
| GET | `/oauth/{provider}/callback` | OAuth callback (posts message to opener) |
| DELETE | `/oauth/{provider}` | Disconnect a provider |
| GET | `/oauth/connections` | List connected providers + postable targets |
| GET | `/oauth/meta/accounts` | Pages + IG accounts behind the current Meta token |
| GET | `/telegram/status` | Telegram bot connectivity + chat-id presence |
| POST | `/telegram/webhook` | Inline-button callbacks from the validation bot |
| POST | `/validation/submit` | Push a draft to the Telegram approval queue |
| GET | `/privacy`, `/terms` | HTML pages required by Meta/TikTok/LinkedIn portals |
| GET | `/tiktok{token}.txt` | TikTok domain-verification file |
| - | `/content/*` | Static-mounted uploaded media |

Authenticated browser flows should use `/auth/login`; the backend sets an
HttpOnly session cookie and `/auth/me` restores the user. `BACKEND_AUTH_TOKEN`
is reserved for optional server-to-server access. Anonymous access is
controlled by `ALLOW_OPEN_AUTH` and should stay disabled in production.

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
| `BACKEND_AUTH_TOKEN` | no | Optional shared bearer token for non-browser/server-to-server clients |
| `ALLOW_OPEN_AUTH` | no | Dev-only anonymous access switch; defaults off in production |
| `AUTH_RATE_LIMIT_ATTEMPTS` / `AUTH_RATE_LIMIT_WINDOW_SECONDS` | no | Login/register throttling; defaults to `10` attempts per `300` seconds |
| `OAUTH_REDIRECT_BASE` | for OAuth | Public HTTPS host receiving callbacks |
| `PUBLIC_BASE_URL` | no | Overrides URL used by `/upload` for media; must publicly serve `/content/*` for Instagram/TikTok pulls |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_DEFAULT_CHAT_ID` / `TELEGRAM_WEBHOOK_SECRET` | for Telegram validation | `TELEGRAM_WEBHOOK_SECRET` is required whenever the bot is enabled |
| `META_APP_ID` / `META_APP_SECRET` | for Meta | Facebook + Instagram |
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` / `TIKTOK_DOMAIN_VERIFY` | for TikTok | |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | for LinkedIn | |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | for Google sign-in | |
| `CONTENT_DIR` | no | Defaults to `/home/app/content` in the container |
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
docker compose -f infra/docker-compose.yml up -d --build caption-api
docker compose -f infra/docker-compose.yml exec -T caption-api python -m pytest /home/app/tests -q
```

For Windows operators there is also a helper:

```powershell
powershell -ExecutionPolicy Bypass -File .\backend\run-tests.ps1
```

The frontend handles CORS via `CORS_ALLOW_ORIGINS` (defaults include
`http://localhost:3000`), so no Next.js rewrite proxy is required.
