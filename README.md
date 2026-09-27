# focuz-note (Focuz-Node)

Integration repository that bundles:
- `focuz-web/` (frontend)
- `focuz-api/` (backend)

**Status**: alpha  
**Version**: 0.1.0-alpha

## Environments (Docker Compose)

From repo root:

```bash
# production-like
APP_ENV=production docker compose up -d --build

# test environment (enables experimental features via feature flags)
APP_ENV=test docker compose up -d --build
```

## Versions

- **Focuz-Node**: `0.1.0-alpha` (this repo, see `package.json`)
- **Focuz-Web**: `0.1.0-alpha` (see `focuz-web/package.json`)
- **Focuz-API**: `0.1.0-alpha` (see `focuz-api/pkg/buildinfo`)


## Tests

```bash
# API: e2e suite (Postgres + MinIO + API in containers)
docker compose -f docker-compose.test.yml up --build --abort-on-container-exit test-runner

# Web: unit tests (sync engine, IndexedDB migrations) — no backend needed
cd focuz-web && npm ci && npm test

# Web: end-to-end against a running stack (APP_ENV=... docker compose up -d --build)
cd focuz-web && E2E_WEB_URL=http://localhost:8081 E2E_API_URL=http://localhost:8080 npm run test:e2e
```

## Upgrading existing data

- API: migration `000002_client_ids` only adds nullable columns and partial unique indexes
  (`note.client_id`, `filters.client_id`); existing rows are not modified.
- Web: IndexedDB schema v9 converts `notes.parentId` to local ids in place and resets the
  attachment job queue; no data is deleted. Unsynced changes made with the previous version
  are pushed on the first sync.

## Security checklist for a self-hosted install

- Set your own secrets in `.env` (see `env.example`): `JWT_SECRET` (e.g. `openssl rand -hex 32`),
  `POSTGRES_PASSWORD`, `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`. The compose defaults are public;
  with the default `JWT_SECRET` anyone can forge a login token (the API logs a warning at startup).
  Changing `JWT_SECRET` signs everyone out once.
- Postgres and the MinIO console are bound to localhost. Keep it that way unless you need them remotely.
- If the API is not behind a reverse proxy, set `TRUSTED_PROXIES` to an empty value or to your proxy's
  address only: with the default private ranges, clients can spoof their IP via `X-Forwarded-For`
  and bypass per-IP rate limits (logins are additionally limited per account).
