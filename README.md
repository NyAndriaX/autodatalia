# Datalia — Marketing Automation Platform

Multi-user marketing-automation platform: a team plans, generates, schedules,
validates and publishes content across social accounts (Facebook Pages,
Instagram Business, TikTok, LinkedIn). Each member signs in and connects
**their own** social accounts — OAuth tokens, posts and app state are scoped
per user. The first account (created via `/auth/register`) is the admin and
registration then closes; additional members are provisioned through Google
sign-in. Running as a multi-tenant product (rather than a single shared login)
is also what TikTok's API review requires.

> ## ▶ Deploying this to production?
> **Read [`DEPLOY.md`](DEPLOY.md).** It's a top-to-bottom checklist —
> server setup, secrets, Telegram bot, social-portal config, smoke test.
> Follow it once and the app is live on your domain.

---

## What's in the box

| Module | Status |
|---|---|
| Manual post creation + AI caption generation + image/video uploads | Done |
| Calendar + scheduling + auto-publish | Done |
| OAuth for Facebook Pages, Instagram Business, TikTok, LinkedIn | Done |
| Image cropping per platform ratio + spam guards | Done |
| **AI image generation** — Nano Banana (Gemini 2.5 Flash Image) via OpenRouter, auto-falls-back to a local poster if provider credits fail | Done |
| **AI video generation** — LTX-2 (Lightricks official) → fal.ai → ffmpeg Ken Burns fallback, auto-fallback on provider failure | Done |
| **Cost dashboard** — per-call / per-workflow / per-tier / per-model spend in MariaDB-backed log | Done |
| **3-tier LLM routing** — Fast (hashtags/transforms), Standard (variants), Premium (n≥3 variants) | Done |
| **Automation module** — auto-generate posts on a recurring schedule | Done (Phase 1–3) |
| **Telegram validation gate** — every auto-generated post requires explicit user approval before publish, manual approvals publish immediately | Done |
| **Timeout follow-up** — bot prompts resend/regenerate/cancel if no answer by publish time | Done |
| **i18n** — English + French, language switcher in Topbar + Settings | Done (Sidebar, Topbar, Dashboard, Credits, Video, Settings) |

For per-platform publish state see [`PROJECT_STATE.md`](PROJECT_STATE.md).

---

## Repository layout

| Path | Layer | Stack |
|---|---|---|
| [`frontend/`](frontend/) | Dashboard UI | Next.js 16 (App Router), React 19, Redux Toolkit, Tailwind v4 |
| [`backend/`](backend/) | API + AI + OAuth + publishing + automation worker | Python, FastAPI, Pydantic, Docker |
| [`infra/`](infra/) | Docker Compose orchestration + Caddy reverse-proxy config | YAML |
| [`docs/`](docs/) | Per-platform setup notes (TikTok, etc.) | Markdown |
| [`DEPLOY.md`](DEPLOY.md) | **Production deploy checklist** | Markdown |

---

## Architecture (current)

```
[Frontend (Next.js)] ──HTTP──▶ [Backend (FastAPI)] ──▶ OpenRouter (text + Nano Banana)
                                       │              ──▶ LTX-2 / fal.ai (video)
                                       │
                                       ├──▶ Meta Graph API   (Facebook + Instagram)
                                       ├──▶ TikTok API
                                       ├──▶ LinkedIn API
                                       ├──▶ Telegram Bot API (validation gate)
                                       └──▶ MariaDB (auth + app state)
```

Three background loops inside the backend process:
- **scheduler** — fires posts whose `status == "scheduled"` and whose
  `scheduledDate + time` is now in the past.
- **automation worker** — scans active automation rules, generates
  candidate posts AI-side, submits them to Telegram for approval.
  Approved candidates flip to `status="scheduled"` and the scheduler
  picks them up like any other scheduled post.
  Rule bookkeeping (`last_fire_at`, `last_error`) does not count as a
  real rule edit, so already-generated validation cards stay approvable
  unless the user actually changes the rule itself.
- **video jobs worker** — polls the queued LTX / fal jobs, downloads
  finished MP4s, auto-falls-back to ffmpeg Ken Burns if the external
  provider raises so the user always gets *a* video.

Storage is split by type: uploaded media still lives on the Docker
content volume, while auth, posts, automation rules, OAuth tokens,
runtime API keys, cost logs, video jobs and the activity feed live in
MariaDB. The default compose ships an in-stack MariaDB container; prod
can point `DATABASE_URL` at a managed MariaDB/MySQL host instead.

---

## Run it locally

### Backend (Docker)
```bash
docker compose -f infra/docker-compose.yml up -d --build caption-api
# caption-api → http://localhost:8000
```

### Full local stack (Docker)
```bash
docker compose -f infra/docker-compose.yml up -d --build
# frontend    → http://localhost:3005
# caption-api → http://localhost:8000
```

For the simplest operator flow, this is the only command needed for a local
run. Docker Compose brings up MariaDB automatically; there is no separate
database install or manual schema step.

Windows helper:

```powershell
powershell -ExecutionPolicy Bypass -File .\infra\start-local.ps1
```

Meta and TikTok require HTTPS OAuth callbacks, so for OAuth testing point
a public HTTPS host at the backend and set `OAUTH_REDIRECT_BASE` +
`PUBLIC_BASE_URL` in `infra/.env` to that URL. Any tunneling service
that gives a stable HTTPS hostname works (Cloudflare Tunnel, Tailscale
Funnel, etc.). That same host must also serve `/content/...` URLs for
scheduled Instagram/TikTok publishes, because those platforms pull the
media file directly from the public URL. For production deployment see
[`DEPLOY.md`](DEPLOY.md).

### Frontend
```bash
cd frontend
npm install
cp .env.example .env.local        # set NEXT_PUBLIC_API_BASE_URL
npm run dev                       # http://localhost:3000
```

### Backend tests
```bash
docker compose -f infra/docker-compose.yml exec -T caption-api \
  python -m pytest tests/ -q
```

On Windows there is also:

```powershell
powershell -ExecutionPolicy Bypass -File .\backend\run-tests.ps1
```

---

## Per-platform status

| Platform   | OAuth | Publish |
|------------|-------|---------|
| Facebook   | Yes   | Text + photo + video + multi-photo carousel — confirmed |
| Instagram  | Yes   | Image + video + multi-slide carousel — confirmed on a stable HTTPS domain (per-child polling dropped for image carousels, parent-create backoff up to ~42s for Meta eventual consistency) |
| TikTok     | Yes   | Photo carousels + video, direct mode default with automatic scope-aware downgrade to inbox |
| LinkedIn   | Yes   | Text + single image — implemented, end-to-end pending a connected token |
| Google     | Sign-in only | n/a |

When the scheduler fires a post, every requested platform produces a
result row — no more silent drops. Platforms that aren't connected get
an explicit `meta_not_connected` / `tiktok_not_connected` /
`no_instagram_business_linked_to_page` error in the bell feed.

---

## Useful docs

- [`DEPLOY.md`](DEPLOY.md) — **production deploy checklist**
- [`PROJECT_STATE.md`](PROJECT_STATE.md) — current source-verified state
- [`backend/README.md`](backend/README.md) — API surface
- [`docs/tiktok.md`](docs/tiktok.md) — TikTok-specific setup notes
