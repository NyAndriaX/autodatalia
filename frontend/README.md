# Frontend

Next.js dashboard for Datalia.

## Stack

- Next.js 16
- React 19
- Redux Toolkit
- Tailwind CSS

## Current behavior

The frontend covers:

- login and registration
- workspace switcher
- workspace creation
- invitations
- Team & Access views
- create post workflow
- media library
- calendar
- automation
- settings
- notifications

Important behavior:

- auth is cookie-based
- the active workspace changes the visible data
- editor state is stored per workspace
- locale is stored per workspace/browser state
- the app expects the backend to be the source of truth

## Main folders

- `app/components/layout` — sidebar, topbar, workspace controls
- `app/components/views` — dashboard views
- `app/store` — Redux slices and thunks
- `app/lib` — API/services/helpers
- `messages` — `en` and `fr`

## Local run

Recommended local path is the root Docker stack:

```bash
docker compose -f infra/docker-compose.yml up -d --build
```

Local URL:

- `http://localhost:3005`

If you run the frontend alone:

```bash
cd frontend
npm install
npm run dev
```

## Scripts

- `npm run dev`
- `npm run build`
- `npm start`
- `npm run lint`

## Environment

Main frontend env:

- `NEXT_PUBLIC_API_BASE_URL`

In the local Docker flow, the compose/build setup already wires frontend to backend.

## Production notes

- production frontend runs through Dokploy
- Traefik routes the public domain to container port `3000`
- domain changes require a rebuild because the API URL is baked at build time

See:

- [../README.md](../README.md)
- [../DEPLOY.md](../DEPLOY.md)
