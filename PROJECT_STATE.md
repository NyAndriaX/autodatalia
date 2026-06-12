# Datalia Project State

Last updated: 2026-06-12 — code-verified correction pass (DB engine,
tenancy, Instagram carousel status).

This file is a source-verified snapshot for the repo. **`README.md` is the
canonical source of truth**; when this file disagrees with it, README wins.

## What runs

- **`frontend/`** — Next.js 16 (App Router, Turbopack), React 19, Redux
  Toolkit, Tailwind v4, next-intl 4.12 (en + fr).
- **`backend/`** — FastAPI on `caption-api`. Three async background loops
  start with the app: scheduler (fires due posts), automation worker
  (generates rule-driven candidates), video jobs worker (polls external
  video providers).
- **`infra/docker-compose.yml`** — dev: `caption-api` + `mariadb:11.4`.
- **`infra/docker-compose.prod.yml`** — prod: Caddy + `caption-api` +
  `mariadb:11.4` (or external MariaDB/MySQL via `DATABASE_URL`, scheme
  `mysql://` or `mariadb://`).

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

Persistent per-call cost log (MariaDB `cost_logs` collection, per user) with workflow / tier / model / user breakdown. Pricing table for OpenRouter common models + media providers (Nano Banana $0.03/img, LTX $0.04/s, etc.). Cached hits are recorded with `cost_usd=0` so "tokens saved by cache" stats are real.

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

App state lives in **MariaDB**, not in JSON files. The old file-backed stores
are migrated into the DB once on startup by `migrate_legacy_state()` (`db.py`),
after which the DB is canonical. Two MariaDB tables hold everything:

- **`users`** — login accounts (email, bcrypt hash, name, role).
- **`_DOC_TABLE`** (`collection_name` / `scope_key` / `doc_id` / `payload_json`)
  — a per-user-scoped document store holding all of the below.

| Store | Collection / blob | Was (legacy file) | Backup priority |
|---|---|---|---|
| MariaDB `users` table | — | (always DB) | High |
| MariaDB doc table | `posts` | `posts.json` | High |
| MariaDB doc table | `automation_rules` | `automation_rules.json` | High |
| MariaDB doc table | `oauth_tokens` (scoped blob) | `.oauth_tokens*.json` | High |
| MariaDB doc table | `runtime_settings` (scoped blob) | `runtime_settings*.json` | High — runtime API keys |
| MariaDB doc table | `messages` | `messages.json` | Medium |
| MariaDB doc table | `cost_logs` | `cost_logs.json` | Medium |
| MariaDB doc table | `video_jobs` | `video_jobs.json` | Low |
| MariaDB doc table | `ai_cache` (scoped blob) | `.ai_cache.json` | Low — regenerates |
| `content/`, `content/generated/` (volume) | — | uploaded + AI media | High |

In Docker, two volumes: `caption-content` holds only the media files; the
`mariadb-data` volume (or your managed `DATABASE_URL`) holds **all** the
structured state above. **Backup must cover both** — dumping only the `users`
table would lose posts, rules, OAuth tokens and runtime API keys.

## Publishing — per-platform status

| Platform | OAuth | Publish | Notes |
|---|---|---|---|
| Facebook | ✅ | ✅ Text + photo + video + multi-photo carousel | Confirmed live. `attached_media` is sent as a JSON-encoded array. |
| Instagram | ✅ | ✅ Single image + video + multi-slide carousel | Carousel confirmed working on a stable HTTPS domain. Image carousels skip per-child polling; parent-create retries up to 8× (~42s) to ride out Meta eventual consistency (the old 9004/100-subcode-33 on ngrok-style hosts). |
| TikTok | ✅ | ✅ Photo carousels + video | `audit_mode="direct"` default with scope-aware downgrade. 24h token auto-refresh on every publish. |
| LinkedIn | ✅ | ✅ Text + single image + video | Token auto-refresh added (~60-day lifetime). Video via chunked Videos API. End-to-end (esp. video) pending a connected token — implemented, not yet live-verified. |
| Google | Sign-in only | n/a | Awaiting `GOOGLE_CLIENT_SECRET`. |

The scheduler now surfaces every requested platform's outcome — no more silent IG/TikTok drops. Unconnected platforms emit explicit `meta_not_connected` / `tiktok_not_connected` / `no_instagram_business_linked_to_page` errors in the bell feed.

## Known gaps (deliberately documented, not blocked)

- **i18n coverage** is shipped for the layout shell + 4 main views. The bundles are complete; remaining views need `useTranslations` wiring. Fall-through behaviour is safe (English text shows for keys not yet swapped).
- **LinkedIn video publishing** — text, image, and video implemented (chunked Videos API); video pending live end-to-end verification.
- **Engagement metrics** (reach, impressions, post performance) are not wired. Analytics view labels them as "Sample data — engagement metrics not yet wired."
- **OpenRouter balance** — the bundled dev `AI_IMAGE_API_KEY` is low on credit; a fresh free-tier signup or a $5 top-up unlocks Nano Banana again. Detection: image gen returns HTTP 402 with `"requires more credits"`.

## Blockers for prod

- **Stable HTTPS domain** behind Caddy via `docker-compose.prod.yml` — needed for OAuth callbacks and for platforms that pull `/content/...` media directly; also stops relying on dev tunnels (which is what used to break Instagram carousels with Meta 9004).
- **`BACKEND_AUTH_TOKEN`** + a fresh `JWT_SECRET` (`openssl rand -hex 32` each) before exposing the API publicly.
- **`MARIADB_PASSWORD`** (and `MARIADB_ROOT_PASSWORD`) must be overridden from the example defaults in prod.
- See `DEPLOY.md` for the top-to-bottom checklist.

## Recently shipped (this handoff round)

- LTX-2 official API wired as primary video provider (sync MP4 endpoint).
- Auto-fallback when external video provider raises at runtime.
- Image generation model id fixed (OpenRouter dropped `-preview` suffix on Nano Banana stable).
- MariaDB (PyMySQL) backs the users table and per-user scoped app state; schema init runs on FastAPI startup with retry.
- next-intl + en/fr bundles + language switcher (Topbar + Settings).
- Telegram validation cards now embed the post's media (photo / video / carousel).
- Manual Telegram approve now actually publishes (was stuck at `status=approved`).
- Automation rules without a Telegram destination are refused at the worker tick (CEO requirement: never auto-publish without approval).
- Build verified clean (Next.js production build + backend module imports).
