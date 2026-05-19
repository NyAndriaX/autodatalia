# DATALIA Backend — Caption / LLM Router API

Python **FastAPI** service: the business-logic & AI layer of DATALIA. The current
prototype generates Instagram & TikTok captions for images via an
OpenAI-compatible provider (OpenRouter). It will grow into the full **LLM Router**
described in [`plans/architecture_plan.md`](../plans/architecture_plan.md)
(prompt-driven generation, multi-model routing, hashtags, image resize).

Run via Docker Compose from [`../infra/`](../infra/) (recommended), or standalone.

## Project structure

```
backend/
├── Dockerfile
├── .dockerignore
├── requirements.txt
├── content/              # Drop images here (volume-mounted in compose)
│   └── .gitkeep
└── app/
    ├── __init__.py
    ├── main.py           # FastAPI entrypoint
    ├── config.py         # Environment / settings
    ├── models.py         # Pydantic request & response schemas
    ├── routes.py         # API endpoint handlers
    ├── services.py       # AI generation & content scanning
    └── tunnel.py         # Cloudflared tunnel management
```

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (`{"status":"ok"}`) — also used by the frontend connectivity indicator |
| GET | `/tunnel-status` | Cloudflared tunnel info |
| GET | `/content-items` | List images in the content folder |
| POST | `/captions/generate` | Generate AI captions for images |

### POST `/captions/generate`

Request:
```json
{ "limit": 5, "save_results": true, "include_images_to_ai": true }
```
Each response item: `filename` · `relative_path` · `description` · `image_url` ·
`image_base64` · `instagram_caption` · `tiktok_caption`.

> Note: this endpoint captions pre-existing server-side images; it does **not** yet
> accept a free-text user prompt. A prompt-driven endpoint is planned (LLM Router).

## Run standalone (without Docker)

```bash
cd backend
pip install -r requirements.txt
export AI_API_KEY=sk-or-v1-...        # OpenRouter key
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `AI_API_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI-compatible endpoint |
| `AI_API_KEY` | _(required)_ | Provider API key |
| `AI_MODEL` | `google/gemini-2.0-flash-lite-001` | Model slug |
| `AI_INCLUDE_IMAGES` | `true` | Send images for vision-based captioning |
| `CONTENT_DIR` | `/app/content` | Image directory |

When running via `infra/docker-compose.yml` these are supplied from `infra/.env`.

## CORS

The app currently has **no `CORSMiddleware`**, so browser calls from the frontend
dev server (`localhost:3000`) to `localhost:8000` are blocked. The frontend works
around this with a same-origin Next.js rewrite proxy (`/api/backend` →
`localhost:8000`). If you prefer direct calls, add `fastapi.middleware.cors.CORSMiddleware`
to `app/main.py`.