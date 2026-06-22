# Infra

This folder contains the Docker setup for Datalia.

## Files

- `docker-compose.yml` — local development stack
- `docker-compose.prod.yml` — production stack for Dokploy
- `.env` — local secrets, not committed
- `.env.production.example` — production env template
- `start-local.ps1` — Windows helper for local start

## Local

Run the local stack with:

```bash
docker compose -f infra/docker-compose.yml up -d --build
```

Local URLs:

- frontend: `http://localhost:3005`
- backend: `http://localhost:8000`

Local stack contents:

- `frontend`
- `caption-api`
- `mariadb`

Important local notes:

- the compose project name is `infra`
- the local MariaDB volume is kept as `datalia_mariadb_data`
- frontend talks to backend through the local proxy setup already defined in the compose

## Production

Production uses:

- `infra/docker-compose.prod.yml`
- Dokploy
- Dokploy's Traefik

Production stack contents:

- `frontend`
- `caption-api`
- `mariadb`

Important production notes:

- no Caddy
- no manual host port publishing
- keep exactly one backend replica
- do not rename the pinned volumes
  - `datalia_mariadb-data`
  - `datalia_caption-content`

See [../DEPLOY.md](../DEPLOY.md) for the exact production steps.
