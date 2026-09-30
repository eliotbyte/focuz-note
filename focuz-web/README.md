# Focuz Web

Frontend for **focuz-note** (local-first notes).

**Status**: alpha  
**Version**: 0.1.0-alpha

## Environment

Vite env variables:
- `VITE_API_BASE_URL`: API base URL (e.g. `http://localhost:8080`)
- `VITE_APP_ENV`: runtime environment (`production` | `test`)
- `VITE_ALLOW_CUSTOM_SERVER`: `true` (default) lets people pick another focuz server on the sign-in
  screen; `false` locks this web app to `VITE_API_BASE_URL`

## Run (via Docker Compose)

From repo root:

```bash
# production-like
APP_ENV=production docker compose up -d --build

# test environment toggles (feature flags enable experimental UI)
APP_ENV=test docker compose up -d --build
```

## Tests

```bash
npm test            # unit tests (vitest + fake-indexeddb): sync engine, IndexedDB migrations, filters tree
npm run test:e2e    # end-to-end (Playwright) against a running stack
```

Unit tests run the real sync code against an in-memory fake of the API (`src/test/fake-server.ts`):
push/pull, parent mapping between devices, conflicts, server outages, timeouts, the attachment queue,
and the IndexedDB upgrade from the previous schema.

E2E tests need the stack running (e.g. `docker compose up` in focuz-note):

```bash
E2E_WEB_URL=http://localhost:8081 E2E_API_URL=http://localhost:8080 npm run test:e2e
# optional: E2E_SHOTS_DIR=./shots to save screenshots, PW_CHROMIUM_PATH=/path/to/chromium
```

## Sync in short

- All edits are written to IndexedDB first; the UI never waits for the server.
- One tab (elected with the Web Locks API) syncs: `POST /sync` (push) then `GET /sync` (pull).
- Failed syncs are retried with exponential backoff (2s … 60s); "server unreachable" is shown in the
  status chip in the top bar, and sync resumes by itself when the server is back.
- Images are uploaded/downloaded by a background queue (`jobs` table). Network problems never mark a
  transfer as failed; other errors are retried 5 times, then can be retried from the status menu.
- Conflicts (a note changed on two devices) keep the server version and save the local text as a
  separate note tagged `conflict`.
