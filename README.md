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
- Note text is now read as Markdown (GFM checklists `- [ ] item`). Existing plain-text notes are not
  rewritten and display as before (line breaks kept, no raw HTML); a note only changes when you edit it.

## Shared spaces

Everyone has a personal space that only they can see. To work with others, create a shared space
(the “+” under the spaces on the left) and invite people by username, or by e-mail on an e-mail
server. Invitations arrive under the bell (and by e-mail if the person turned that on in Settings →
Notifications); the answer to an invitation never reveals whether an account exists.

| Role   | Can do |
|--------|--------|
| Owner  | Everything, including deleting the space and making admins |
| Admin  | Invite and remove people, change roles (up to editor), rename, publish anything |
| Editor | Write notes, edit any note, delete their own, publish their own notes |
| Guest  | Read only |

Notes in shared spaces show their author; ⋮ → Details lists who changed a note and when. Folders
stay personal: each member organizes the same notes their own way.

Public links (read-only, no sign-in, planet icon on the note): ⋮ → Share makes a note public, by
default with all its replies (turn “Replies are public too” off to share only the note); Space menu
→ Public links makes a whole shared space public. “Make private” stops a link for good.

Upgrading: migration `000004_sharing` is additive. Members that were invited before (then called
“guest”, but able to write) become editors; pending invitations are kept.

## Folders

Saved filters are shown as folders. A folder shows the notes that match its rule (tags, excluded
tags, text, open checklist items) plus everything its subfolders show; a folder without a rule is
just a group. Notes are never stored inside a folder: a folder whose rule is only tags works like a
classic folder, because notes written in it (or ticked via ⋮ → Folders…) get those tags. Top-level
notes that are in no folder appear in Unsorted. Deleting a folder never deletes notes unless you
tick the option, and then only notes that would be in no other folder.

Existing saved filters keep their rules and places. One visible change: a filter with nested
filters now also shows their notes; "Only this folder" shows just its own.

## Security checklist for a self-hosted install

- Set your own secrets in `.env` (see `env.example`): `POSTGRES_PASSWORD`, `MINIO_ROOT_USER` /
  `MINIO_ROOT_PASSWORD`. The compose defaults are public.
- `JWT_SECRET`: leave it empty and the API generates a random one on first start (kept in the
  database), or set your own (e.g. `openssl rand -hex 32`). The API refuses to start with a publicly
  known value such as the old compose default. Changing it signs everyone out once.
- Postgres and MinIO (S3 API and console) are bound to localhost: the web app gets files through the
  API. Keep it that way; with the default MinIO credentials an exposed port 9000 gives away every file.
- `TRUSTED_PROXIES` (default: loopback only): if you put a reverse proxy in front of the API, set it
  to that proxy's address only. Never list whole private ranges without a real proxy: clients could
  then spoof their IP via `X-Forwarded-For`, fake it in the logs and bypass per-IP rate limits.
- `RATE_LIMIT_WHITELIST` is empty by default. Don't add the Docker network or other ranges all
  traffic may arrive from, or the global rate limit stops applying to everyone.
- Without a reverse proxy, Docker Desktop (Windows/macOS) shows every client to the API as the same
  gateway address, so per-IP limits are shared by all clients. For a public server, run the API
  behind a reverse proxy that sets `X-Forwarded-For`, and trust only that proxy.
- `REGISTRATION=closed` for a private instance, once your accounts exist.

## Accounts and e-mail

Set in `.env` (see `env.example`):

- `AUTH_MODE=username` (default): people sign up with a username.
- `AUTH_MODE=email`: people sign up with an e-mail address. The server e-mails a 6-digit code (and a
  confirmation link if `PUBLIC_API_URL` is set); the account can sign in only after confirming.
  Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`.
  Without `SMTP_HOST` the e-mail is printed to the API log, which is enough to try it out.
  Existing username accounts keep working after switching.
- `REGISTRATION=closed` turns off sign-up.

## Choosing the server in the web app

The web app is only the client: on the sign-in screen, "Server … · Change" lets people type the
address of any focuz server (like Bitwarden clients with a self-hosted Vaultwarden). The sign-in
form adapts to that server (username or e-mail, sign-up open or closed). `VITE_API_BASE_URL` is just
the default. For a web app on another domain to connect, the server needs that origin in
`ALLOWED_ORIGINS`, or `ALLOWED_ORIGINS=*`.

To lock the web app to your own server, build it with `VITE_ALLOW_CUSTOM_SERVER=false` (in `.env`,
then `docker compose up -d --build web`): the "Change" link disappears and a server chosen earlier
in a browser is ignored.
