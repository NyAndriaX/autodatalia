# DATALIA Frontend — Dashboard

Next.js 16 (App Router) dashboard for the DATALIA marketing-automation platform.
See the repo [root README](../README.md) and [`docs/PassFront.md`](../docs/PassFront.md)
for the broader architecture and handoff notes.

## Stack

- **Next.js 16.2.6** (App Router) · **React 19**
- **Redux Toolkit** (`@reduxjs/toolkit`) + React-Redux — global state
- **Tailwind CSS v4** + a CSS-variable design system in `app/globals.css`
- **lucide-react** icons

## Project structure

```
frontend/
├── app/
│   ├── page.js                 # Shell: renders the active view
│   ├── layout.js               # Root layout + no-flash theme script
│   ├── globals.css             # Light/dark design tokens & utilities
│   ├── components/
│   │   ├── providers/          # ReduxProvider, AppBootstrap
│   │   ├── layout/             # Sidebar, Topbar
│   │   └── views/              # CreationEditor, MediaUploader, PlaceholderView
│   ├── store/                  # Redux slices + plain thunk factories
│   │                           #   editor/ui/auth slices, *Thunks
│   └── lib/                    # Service layer (config, apiClient, aiService,
│                               #   webhookService, authService, searchService,
│                               #   messagesService, uploadService, theme)
├── .env.example                # Copy to .env.local
└── next.config.mjs             # Includes a /api/backend rewrite proxy
```

## Getting started

```bash
npm install
cp .env.example .env.local      # optional — see below
npm run dev                     # http://localhost:3000
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server (http://localhost:3000) |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint over the project |
| `npm run lint:fix` | ESLint with `--fix` |

## Environment variables

All client-side, so they use the `NEXT_PUBLIC_` prefix and are read in one place
(`app/lib/config.js`). Restart `next dev` after changing them.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | Backend base URL. Empty → AI uses the local mock only. Set to `/api/backend` to use the built-in CORS-free rewrite proxy to `localhost:8000`. |
| `NEXT_PUBLIC_N8N_SAVE_DRAFT_URL` | n8n webhook for "Save as Draft". Blank → button updates status + notifies locally, no POST. |
| `NEXT_PUBLIC_N8N_SUBMIT_VALIDATION_URL` | n8n webhook for "Submit for Validation". |
| `NEXT_PUBLIC_N8N_PUBLISH_URL` | n8n webhook for "Publish Now". |

### Graceful degradation

The backend, n8n and Telegram bot are not all built yet. The frontend is fully
usable regardless:

- **AI generation** calls the backend; on any error / unreachable / incompatible
  response it transparently falls back to a local mock generator.
- **Action buttons** update Redux post status and raise an in-app notification;
  they only POST to n8n when the corresponding webhook URL is configured.
- **Telegram indicator** reflects backend `/health` reachability (honest 3-state:
  online / offline / unknown) instead of a hardcoded value.
- **Media upload** previews images/video locally (object URLs) and attempts a
  background `POST /upload`; the preview works whether or not that endpoint exists.
- **Auth / search / messages** run on `authService` / `searchService` /
  `messagesService` mock stubs that try the backend first (`/auth/*`, `/search`,
  `/messages`) and fall back to seed data — each a one-function swap when the
  real endpoint lands.

### Theming

Light/dark are CSS-variable token sets in `globals.css`. Preference
(`light` / `dark` / `system`) lives in `uiSlice`, persists to `localStorage`,
and follows the OS when set to `system`. A blocking inline script in
`layout.js` applies the resolved theme before first paint (no flash); the
Topbar toggle flips it. Honors `prefers-reduced-motion`.

> The backend's `/captions/generate` captions server-side images and does not yet
> accept a free-text prompt, so with the backend up the editor still uses the mock
> for prompt-driven generation. Swapping to a future free-prompt endpoint is a
> one-function change in `app/lib/aiService.js`.