# Datalia — Marketing Automation Platform

Internal tool used by the Datalia team to plan, generate, schedule, validate
and publish content across Datalia's **own** social accounts (Facebook
Pages, Instagram Business, TikTok, LinkedIn). Not SaaS-for-clients —
exactly one tenant (Datalia itself), OAuth connections happen once at setup.

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
| **Automation module** — auto-generate posts on a recurring schedule | Done (Phase 1–3) |
| **Telegram validation gate** — every auto-generated post requires explicit user approval before publish | Done |
| **Timeout follow-up** — bot prompts resend/regenerate/cancel if no answer by publish time | Done |

For per-platform publish state see [`PROJECT_STATE.md`](PROJECT_STATE.md).
For engineering reference (file layout, conventions, gotchas) see
[`CLAUDE.md`](CLAUDE.md).

---

## Repository layout

| Path | Layer | Stack |
|---|---|---|
| [`frontend/`](frontend/) | Dashboard UI | Next.js 16 (App Router), React 19, Redux Toolkit, Tailwind v4 |
| [`backend/`](backend/) | API + AI + OAuth + publishing + automation worker | Python, FastAPI, Pydantic, Docker |
| [`infra/`](infra/) | Docker Compose orchestration + Caddy reverse-proxy config | YAML |
| [`docs/`](docs/) | Per-platform setup notes (TikTok, etc.) | Markdown |
| [`plans/`](plans/) | Architecture decisions + roadmap | Markdown |
| [`DEPLOY.md`](DEPLOY.md) | **Production deploy checklist** | Markdown |

---

## Architecture (current)

```
[Frontend (Next.js)] ──HTTP──▶ [Backend (FastAPI)] ──▶ OpenRouter (AI)
                                       │
                                       ├──▶ Meta Graph API   (Facebook + Instagram)
                                       ├──▶ TikTok API
                                       ├──▶ LinkedIn API
                                       └──▶ Telegram Bot API (validation gate)
```

Two background loops inside the backend process:
- **scheduler** — fires posts whose `status == "scheduled"` and whose
  `scheduledDate + time` is now in the past.
- **automation worker** — scans active automation rules, generates
  candidate posts AI-side, submits them to Telegram for approval.
  Approved candidates flip to `status="scheduled"` and the scheduler
  picks them up like any other scheduled post.

Storage is file-based: posts, automation rules, OAuth tokens, and the
activity feed live as JSON in a Docker named volume on prod. Users live
in a tiny SQLite file. No external database needed.

---

## Run it locally

### Backend (Docker)
```bash
docker compose -f infra/docker-compose.yml up -d --build caption-api
# caption-api → http://localhost:8000
```

Meta and TikTok require HTTPS OAuth callbacks, so for OAuth testing point
a public HTTPS host (Tailscale Funnel works without a custom domain) at
the backend and set `OAUTH_REDIRECT_BASE` + `PUBLIC_BASE_URL` in
`infra/.env` to that URL. See [`plans/hosting.md`](plans/hosting.md) for
options.

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

---

## Per-platform status

| Platform   | OAuth | Publish |
|------------|-------|---------|
| Facebook   | Yes   | Text + photo + video + multi-photo carousel — confirmed |
| Instagram  | Yes   | Image + video — single confirmed; carousel hardened (drops per-child polling, longer parent-create backoff) |
| TikTok     | Yes   | Photo carousels + video, inbox/direct modes, 24h-token auto-refresh |
| LinkedIn   | Yes   | Text + single image — implemented, end-to-end pending a connected token |
| Google     | Sign-in only | n/a |

---

## Useful docs

- [`DEPLOY.md`](DEPLOY.md) — **production deploy checklist**
- [`PROJECT_STATE.md`](PROJECT_STATE.md) — current source-verified state
- [`CLAUDE.md`](CLAUDE.md) — engineering reference (architecture, conventions, file layout)
- [`backend/README.md`](backend/README.md) — API surface
- [`docs/tiktok.md`](docs/tiktok.md) — TikTok-specific setup notes
- [`plans/hosting.md`](plans/hosting.md) — hosting decisions and migration plan
- [`plans/next-steps.md`](plans/next-steps.md) — priority backlog
