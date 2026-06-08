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
│                               #   oauthService, authService, searchService,
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

### Graceful degradation

The backend and Telegram validation flow are not always available in local dev.
The frontend is still usable regardless:

- **AI generation** calls the backend; on any error / unreachable / incompatible
  response it transparently falls back to a local mock generator.
- **Action buttons** update Redux post status and raise an in-app notification;
  publish flows call the backend when an API base URL and connections are
  configured.
- **Telegram indicator** reflects backend `/health` reachability (honest 3-state:
  online / offline / unknown) instead of a hardcoded value.
- **Media upload** previews images/video locally (object URLs) and attempts a
  background `POST /upload`; the preview works whether or not that endpoint exists.
- **Auth / search / messages** run on `authService` / `searchService` /
  `messagesService` mock stubs that try the backend first (`/auth/*`, `/search`,
  `/messages`) and fall back to seed data — each a one-function swap when the
  real endpoint lands.

Production note:
- The browser no longer receives a shared backend bearer token. Authenticated
  requests rely on the backend's HttpOnly session cookie; anonymous access
  depends on the backend's `ALLOW_OPEN_AUTH` policy.

### Theming

Light/dark are CSS-variable token sets in `globals.css`. Preference
(`light` / `dark` / `system`) lives in `uiSlice`, persists to `localStorage`,
and follows the OS when set to `system`. A blocking inline script in
`layout.js` applies the resolved theme before first paint (no flash); the
Topbar toggle flips it. Honors `prefers-reduced-motion`.

> Prompt-driven generation uses backend `/generate` when
> `NEXT_PUBLIC_API_BASE_URL` is configured. With no backend, or on backend
> failure, `app/lib/aiService.js` falls back to the local mock generator.
