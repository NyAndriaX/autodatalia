# DATALIA Infra — Orchestration & Deployment

Docker Compose stack that runs **n8n** (workflow automation / orchestration) next
to the **[backend](../backend/) Caption API**. n8n is the central API gateway for
CRON jobs, webhooks, and the publication/validation workflows in
[`plans/architecture_plan.md`](../plans/architecture_plan.md).

```
n8n (:5678) ──HTTP──▶ caption-api (:8000) ──HTTPS──▶ OpenRouter (AI)
```

## Layout

```
infra/
├── docker-compose.yml   # n8n + caption-api (builds ../backend)
├── .env.example         # Safe env template → copy to .env
├── .env                 # Your secrets (git-ignored)
└── .gitignore
```

The `caption-api` service builds from `../backend` (build context `../backend`,
content volume `../backend/content`). Editing the backend code? Change
[`../backend/`](../backend/), not this folder.

## Quick start

```bash
cd infra
cp .env.example .env          # then add your OpenRouter API key
# add images to caption: cp ~/photos/post.jpg ../backend/content/
docker compose up --build
```

| Service     | URL                   |
|-------------|-----------------------|
| n8n         | http://localhost:5678 |
| caption-api | http://localhost:8000 |

## Environment variables (`infra/.env`)

| Variable | Default | Description |
|---|---|---|
| `AI_API_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI-compatible endpoint |
| `AI_API_KEY` | _(required)_ | Provider API key |
| `AI_MODEL` | `google/gemini-2.0-flash-lite-001` | Model slug |
| `AI_INCLUDE_IMAGES` | `true` | Send images for vision-based captioning |

Compose reads these from `infra/.env` automatically.

## n8n workflows — native nodes only

We **do not use the Instagram node** (or any 3rd-party upload node). All
external calls are plain **HTTP Request** nodes. See
[`n8n/README.md`](n8n/README.md) for the full setup and import
[`n8n/webhook-template.json`](n8n/webhook-template.json) as the starter.

```
Webhook ─▶ Code (normalize) ─▶ HTTP Request (Graph API / Telegram / backend) ─▶ Respond
```

- **AI captions/generation**: HTTP Request → `POST http://caption-api:8000/generate`
  (or `/captions/generate`). From inside n8n use the compose service name
  `caption-api`, not `localhost`.
- **Media**: uploaded via the backend `POST /upload`, which returns a public
  URL. n8n forwards that URL to the platform API — no upload node needed.
- **Publish to Instagram**: 2 HTTP Request nodes (create container →
  `media_publish`) against `graph.facebook.com` — details in
  [`n8n/README.md`](n8n/README.md).

## Frontend webhooks

The dashboard's Save / Submit-for-Validation / Publish / **Schedule** buttons
POST the post JSON to n8n webhooks when configured. Import the template once
per endpoint (paths & env-var mapping in [`n8n/README.md`](n8n/README.md)),
then set the matching `NEXT_PUBLIC_N8N_*` vars in
[`../frontend/.env.local`](../frontend/). Until set, the frontend updates
status locally and notifies the user — no breakage.

## Backend endpoints available to n8n / the dashboard

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/health` | Liveness (Topbar status dot) |
| `POST` | `/generate` | Prompt-driven content (editor "Generate via AI") |
| `POST` | `/transform` | Quick AI actions (shorten/expand/tone) |
| `POST` | `/upload` | Store image/video, returns public URL |
| `GET`  | `/search?q=` | Search media in the content dir |
| `POST` | `/captions/generate` | Caption server-side `content/` images |