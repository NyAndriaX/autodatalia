# AutoDatalia AI Coding Agent Instructions

## Purpose
This file helps AI coding agents quickly understand the repository layout, the platform-specific behavior, and the important AI model configuration patterns in AutoDatalia.

## Overview
- `frontend/` contains the Next.js 16 dashboard UI, Redux Toolkit state, Tailwind styling, and service-layer code.
- `backend/` contains the FastAPI service, Pydantic models, OAuth and publish logic, AI generation, image cropping, and local JSON persistence.
- `infra/` contains Docker Compose orchestration for the backend service and local environment setup.
- `docs/` and `plans/` contain handoff and planning notes; do not duplicate content from there unless asked.

## Key guidance for code changes
- The frontend never calls AI or social APIs directly; AI and publish actions flow through the backend.
- OAuth tokens are stored server-side in `backend/content/oauth_tokens.json` and never round-trip through the browser.
- `infra/docker-compose.yml` is the recommended local run configuration for the backend.
- Use existing README docs for context:
  - `README.md` for architecture and run instructions
  - `backend/README.md` for API surface and env vars
  - `frontend/README.md` for client-side setup and scripts

## Model configuration and AI routing
- Backend AI settings live in `backend/app/config.py`.
- Three-tier model routing is intentional and important:
  - `AI_MODEL_FAST` for quick/low-cost tasks such as hashtags, rewrites, or image descriptions.
  - `AI_MODEL` for default content generation and transformation work.
  - `AI_MODEL_PREMIUM` for rare higher-quality tasks; it defaults to `AI_MODEL` when unset.
- Key behavior in `backend/app/services.py`:
  - `generate_captions()` calls `settings.ai_model` for caption generation.
  - Image input is optional and controlled by `AI_INCLUDE_IMAGES`.
  - There is a persistent disk cache for identical AI requests to save tokens.
  - `AI_DAILY_LIMIT` enforces a per-client daily cap and is measured before billing real AI calls.
- When modifying AI behavior, preserve the cost-conscious routing strategy and avoid silently escalating spend.

## Important repository conventions
- Keep public API and backend routes aligned with the documented `backend/README.md` API surface.
- Preserve the frontend/backend separation: changes to feature behavior should generally go through backend endpoints rather than injecting network calls into the client.
- The backend uses `Authorization: Bearer <token>` only when `BACKEND_AUTH_TOKEN` is set; otherwise mutating routes are open in local dev.
- Respect existing guardrails: spam/cooldown checks in `backend/app/publish.py`, image crop caching in `backend/app/images.py`, and token handling in `backend/app/oauth.py`.

## Run and test commands
- Backend: `docker compose -f infra/docker-compose.yml up -d --build caption-api`
- Backend tests: `cd backend && pytest`
- Frontend dev: `cd frontend && npm install && npm run dev`
- Frontend lint: `cd frontend && npm run lint`

## Publishing Quirks and Rules
When touching `backend/app/publish.py`, be aware of these platform-specific requirements:
- **TikTok**: TikTok posting works out-of-the-box (images are posted as carousels, videos as videos). No modifications are needed.
- **Instagram Carousels**: Instagram requires polling `status_code` for **EACH** child container in a Carousel (even for images) before you can create the parent Carousel container. If you skip polling image children, the parent container creation fails with Meta 100 errors.
- **Facebook Carousels**: To post multiple photos to a Facebook Page feed, `attached_media` must be passed as a single JSON-encoded array (e.g. `feed_data["attached_media"] = json.dumps([{"media_fbid": id1}, ...])`). Passing it as indexed keys (`attached_media[0]=...`) via `httpx` form-data often results in Facebook silently ignoring the rest of the array and only publishing the first slide.

## When asked about `model`
- The repository uses environment variables to control model selection for AI calls.
- `AI_MODEL_FAST`, `AI_MODEL`, and `AI_MODEL_PREMIUM` are the primary knobs.
- `AI_MODEL_FAST` is the cheapest model and should be used for low-risk tasks.
- `AI_MODEL_PREMIUM` is reserved for more complex or higher-quality requests and should default to `AI_MODEL` if unset.
- Do not assume the backend is using OpenAI; the configured base URL is `AI_API_BASE_URL`, defaulting to `https://openrouter.ai/api/v1`.

## Notes for agents
- Prefer linking to existing docs rather than copying them verbatim.
- Preserve the current architecture and run commands unless asked to change them.
- For changes affecting environment configuration, update docs or README references only when the change is intentional.
