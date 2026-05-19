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

## n8n workflow setup

```
Trigger ─▶ HTTP Request (POST /captions/generate) ─▶ Code (Base64→Binary) ─▶ Instagram (Upload)
```

1. **HTTP Request node** — `POST http://caption-api:8000/captions/generate`
   (use the compose service name `caption-api`, not `localhost`, from inside n8n).
2. **Code node** — convert `image_base64` → binary:

   ```javascript
   const newItems = [];
   for (const inputItem of $input.all()) {
     for (const dataItem of inputItem.json?.items ?? []) {
       if (!dataItem.image_base64) continue;
       const buf = Buffer.from(dataItem.image_base64.split(',')[1], 'base64');
       newItems.push({
         json: dataItem,
         binary: { data: await this.helpers.prepareBinaryData(buf, dataItem.filename, 'image/png') },
       });
     }
   }
   return newItems;
   ```

3. **Instagram node** — upload using binary field `data`.

## Frontend webhooks (not built yet)

The dashboard's Save / Submit-for-Validation / Publish buttons POST the post JSON
to n8n webhooks when configured. Create the webhook workflows here, then set the
matching `NEXT_PUBLIC_N8N_*` vars in [`../frontend/.env.local`](../frontend/). Until
then the frontend updates status locally and notifies the user — no breakage.