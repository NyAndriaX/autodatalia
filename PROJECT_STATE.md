# Datalia Project State

Last updated: 2026-05-28 — handoff.

This file is the source-verified snapshot for the repo. When it
disagrees with `README.md` or `DEPLOY.md`, this file wins.

## What runs

- **`frontend/`** — Next.js 16 (App Router, Turbopack), React 19, Redux
  Toolkit, Tailwind v4, next-intl 4.12 (en + fr).
- **`backend/`** — FastAPI on `caption-api`. Three async background loops
  start with the app: scheduler (fires due posts), automation worker
  (generates rule-driven candidates), video jobs worker (polls external
  video providers).
- **`infra/docker-compose.yml`** — dev: `caption-api` + `postgres:16-alpine`.
- **`infra/docker-compose.prod.yml`** — prod: Caddy + `caption-api` +
  `postgres:16-alpine` (or external Postgres via `DATABASE_URL`).

## Capabilities

### Backend API

| Surface | Endpoints |
|---|---|
| Health | `GET /health` |
| AI text | `POST /generate` (with `quality=auto\|fast\|standard\|premium`), `POST /transform`, `POST /hashtags`, `POST /captions/generate` |
| AI media | `POST /media/generate/image`, `POST /media/generate/video` (async — returns a `VideoJob`) |
| Video jobs queue | `GET /video-jobs`, `GET /video-jobs/{id}`, `DELETE /video-jobs/{id}` |
| Cost dashboard | `GET /costs/summary?period=24h\|7d\|30d\|all`, `GET /costs/log?limit=N` |
| Upload + serve | `POST /upload`, `GET /content/*`, `DELETE /media/{path}` |
| Calendar | `GET/POST/PATCH/DELETE /posts` |
| Automation rules | `GET/POST/PATCH/DELETE /automation-rules[/{id}]` |
| Publishing | `POST /publish` |
| OAuth | `GET /oauth/{provider}/start`, `GET /oauth/{provider}/callback`, `GET /oauth/connections`, `GET /oauth/status` |
| Auth | `POST /auth/register`, `POST /auth/login`, `GET /auth/me` |
| Telegram | `POST /telegram/webhook`, `POST /validation/submit`, `POST /telegram/test`, `GET /telegram/status` |
| Bell feed | `GET /messages` |

### LLM tier routing

Every AI call routes through one of three tiers, picked per workflow:

- **Fast** (`AI_MODEL_FAST`) — hashtags, transforms, image descriptions, summaries.
- **Standard** (`AI_MODEL`) — single-variant generation, captions.
- **Premium** (`AI_MODEL_PREMIUM`) — auto-escalates when `n_variants >= 3`. Set to a real id (e.g. `anthropic/claude-3.5-sonnet`) to enable; falls back to standard when unset.

Token-conservation features: SHA-256 prompt cache, prompt compression, image-description cache by file content hash, per-client `AI_DAILY_LIMIT`.

### AI image generation (Nano Banana)

- Default model: `google/gemini-2.5-flash-image` (Nano Banana) via OpenRouter.
- Auto-detects Gemini image models and routes through `/chat/completions` with `modalities=["image","text"]` instead of the OpenAI `/images/generations` shape.
- `max_tokens: 2500` cap so OpenRouter low-balance accounts don't hit pre-flight 402s.
- Falls back to a bundled Pillow placeholder when no model is configured (or when the configured one fails).

### AI video generation (LTX-2)

- Provider auto-pick order: **LTX-2 official → fal.ai → ffmpeg Ken Burns**.
- **Auto-fallback at runtime**: when an external provider raises (HTTP 5xx, 402 insufficient credit, 529 overloaded), `run_job` automatically retries on the ffmpeg fallback so the user always gets *a* video. Every attempt is logged in the job record's `attempts` list.
- LTX-2 sync API (`POST /v1/text-to-video`, `POST /v1/image-to-video`) returns MP4 bytes directly — no polling needed.
- 100 free credits on signup at https://console.ltx.video, no credit card required.

### Cost dashboard

Persistent per-call cost log (`backend/content/cost_logs.json`) with workflow / tier / model / user breakdown. Pricing table for OpenRouter common models + media providers (Nano Banana $0.03/img, LTX $0.04/s, etc.). Cached hits are recorded with `cost_usd=0` so "tokens saved by cache" stats are real.

### i18n

- next-intl 4.12, en + fr bundles under `frontend/messages/`.
- Locale persists in Redux + localStorage; auto-detected from `navigator.language` on first load.
- Language switcher in Topbar (🌐 Globe) and in Settings.
- Fully translated views: Sidebar, Topbar, Dashboard headline KPIs, Credits, Video Jobs, Settings.
- Remaining views (CreationEditor, AutomationView, CalendarView, MediaLibraryView, AnalyticsView, all modals, login/register) still render English in both locales — keys exist in the bundles, just need wiring. No broken/missing-key errors.

### Telegram validation

- Every auto-generated post (from automation rules) is gated behind Telegram approval. The worker **refuses to fire a rule without a Telegram destination** — `TELEGRAM_BOT_TOKEN` + `TELEGRAM_DEFAULT_CHAT_ID` (or `validation_chat_id` on the rule) must be configured.
- Validation cards embed the post's image / video / carousel via `sendPhoto` / `sendVideo` / `sendMediaGroup`.
- Manual approve → publishes immediately via `scheduler.fire_post` and reports result back to the same chat.
- Auto-rule approve → flips to `status=scheduled`, scheduler fires at the rule's target time.

## Persistence

| Store | What | Backup priority |
|---|---|---|
| Postgres `users` table | Login accounts (email, bcrypt hash, name) | High — only DB-shaped store |
| `posts.json` | Drafts, scheduled, published, automation candidates | High |
| `automation_rules.json` | Active rules | High |
| `.oauth_tokens*.json` | Provider access tokens | High |
| `messages.json` | Bell-feed activity log | Medium |
| `cost_logs.json` | Per-call AI/media cost rows | Medium |
| `video_jobs.json` | LTX/fal job queue + history | Low |
| `.ai_cache.json` | TTL'd AI response cache | Low — regenerates |
| `content/`, `content/generated/` | Uploaded media + AI outputs | High |

In Docker, two volumes: `caption-content` for the file-based state and `postgres-data` for the SQL store.

## Publishing — per-platform status

| Platform | OAuth | Publish | Notes |
|---|---|---|---|
| Facebook | ✅ | ✅ Text + photo + video + multi-photo carousel | Confirmed live. `attached_media` is sent as a JSON-encoded array. |
| Instagram | ✅ | ✅ Single image + video, 🔴 multi-slide carousel | Carousel is implemented but Meta returns code 9004 on ngrok-style hosts; resolves on a stable HTTPS domain. |
| TikTok | ✅ | ✅ Photo carousels + video | `audit_mode="direct"` default with scope-aware downgrade. 24h token auto-refresh on every publish. |
| LinkedIn | ✅ | ✅ Text + single image | End-to-end pending a connected token. |
| Google | Sign-in only | n/a | Awaiting `GOOGLE_CLIENT_SECRET`. |

The scheduler now surfaces every requested platform's outcome — no more silent IG/TikTok drops. Unconnected platforms emit explicit `meta_not_connected` / `tiktok_not_connected` / `no_instagram_business_linked_to_page` errors in the bell feed.

## Known gaps (deliberately documented, not blocked)

- **i18n coverage** is shipped for the layout shell + 4 main views. The bundles are complete; remaining views need `useTranslations` wiring. Fall-through behaviour is safe (English text shows for keys not yet swapped).
- **LinkedIn video publishing** — text + image works; video unimplemented.
- **Engagement metrics** (reach, impressions, post performance) are not wired. Analytics view labels them as "Sample data — engagement metrics not yet wired."
- **OpenRouter balance** — the bundled dev `AI_IMAGE_API_KEY` is low on credit; a fresh free-tier signup or a $5 top-up unlocks Nano Banana again. Detection: image gen returns HTTP 402 with `"requires more credits"`.

## Blockers for prod

- **Stable HTTPS domain** behind Caddy via `docker-compose.prod.yml`. Resolves Instagram carousels (Meta 9004) and stops relying on dev tunnels.
- **`BACKEND_AUTH_TOKEN`** + a fresh `JWT_SECRET` (`openssl rand -hex 32` each) before exposing the API publicly.
- **`POSTGRES_PASSWORD`** must be overridden from the example default in prod.
- See `DEPLOY.md` for the top-to-bottom checklist.

## Recently shipped (this handoff round)

- LTX-2 official API wired as primary video provider (sync MP4 endpoint).
- Auto-fallback when external video provider raises at runtime.
- Image generation model id fixed (OpenRouter dropped `-preview` suffix on Nano Banana stable).
- Postgres replaces SQLite for the users table; init runs on FastAPI startup with retry.
- next-intl + en/fr bundles + language switcher (Topbar + Settings).
- Telegram validation cards now embed the post's media (photo / video / carousel).
- Manual Telegram approve now actually publishes (was stuck at `status=approved`).
- Automation rules without a Telegram destination are refused at the worker tick (CEO requirement: never auto-publish without approval).
- Build verified clean (Next.js production build + backend module imports).
