# focuz

Notes app: `focuz-api` (Go, gin, Postgres, MinIO) and `focuz-web` (React, Vite, PWA, served by nginx).
`docker-compose.yml` runs the whole stack; see `README.md` for features and configuration.

## Deploying: what must be set (the code cannot do it for you)

When deploying or helping someone deploy, check each item and tell the user which ones are still open.

1. **Secrets in `.env`** (see `env.example`). The compose defaults are public:
   - `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`: the default `minioadmin` gives access to every file.
     The API logs a `SECURITY WARNING` at startup while they are the defaults.
   - `POSTGRES_PASSWORD`.
   - `JWT_SECRET`: leave empty (the API generates one and keeps it in the `server_settings` table) or
     set a random one (`openssl rand -hex 32`). Publicly known values make the API refuse to start.
     Changing it signs everyone out.
2. **Public server: HTTPS reverse proxy in front of the API and the web app.** Without HTTPS,
   passwords and tokens travel in clear text. Set `TRUSTED_PROXIES` to that proxy's address only.
   Without a proxy, Docker Desktop shows every client as one gateway IP, so per-IP rate limits
   (including the login limiter) are shared by everyone.
3. **Ports stay on localhost**: Postgres `5432`, MinIO `9000`/`9001`. Only the API (`8080`) and the
   web app (`8081`) are meant to be reachable. The web app gets files through the API.
4. **Private instance**: once its accounts exist, set `REGISTRATION=closed`.
5. **Rate limits**: keep `RATE_LIMIT_WHITELIST` empty unless you know exact addresses; never list the
   Docker network or other ranges all traffic may come from.
6. **E-mail mode** (`AUTH_MODE=email`): configure `SMTP_*`, and `PUBLIC_API_URL` for confirmation links.
7. After deploying: `curl -sI <web>/` shows `Content-Security-Policy`; the API log has no
   `SECURITY WARNING` lines.

## Security invariants (don't regress these)

A security review (2026-10) fixed these; keep them when changing code:

- No secret defaults in compose. `pkg/jwtsecret` rejects short and published JWT secrets; add any new
  published example value to its list.
- `TRUSTED_PROXIES` and `RATE_LIMIT_WHITELIST` default to empty: any trusted address can set the
  client IP via `X-Forwarded-For`.
- Every handler that writes checks the role, not just membership: `access.CanWrite` /
  `access.CanEditNote` / `access.CanManage` (`pkg/access`), the same rules as `/sync`. Guests are
  read-only. `roleID == 0` alone is only enough for reads.
- 500 responses go through `types.InternalError(c, err)`: driver/SQL errors are logged with the
  request ID and never sent to clients.
- Login tokens are issued and checked only through `pkg/authtoken` (HTTP middleware and WebSocket).
  They carry `token_version`; `UsersRepository.SetPassword` bumps it, which signs out every session.
- The WebSocket takes the token as the `bearer.<token>` subprotocol next to `focuz.v1`, never in the
  URL. The access log writes the URL path only.
- An e-mail sign-up whose code is still valid can't be replaced by a new sign-up (account takeover);
  code attempts are counted atomically (`UsersRepository.UseAttempt`).
- Note Markdown renders with `html: false`; uploads are type-checked by content and served with
  `Content-Disposition: attachment` and a sandbox CSP.
- `focuz-web/security-headers.conf` sets the web app's CSP (only same-origin scripts; the token lives
  in localStorage). A new external script, font or style host must be added there, or it is blocked.
- Dependencies: run `govulncheck ./...` in `focuz-api` and `npm audit --omit=dev` in `focuz-web` when
  updating; build images must be on supported Go/Node versions.

## Working on the code

- API integration tests: `run-api-tests.ps1` (Docker). It shares the compose project name with the
  dev stand and **stops and removes the dev stand's containers** (volumes survive); bring the stand
  back with `docker compose up -d` afterwards.
- Unit tests: `go test ./...` in `focuz-api` for packages without a DB; `npx vitest run` in `focuz-web`.
- Local test accounts are in `LOCAL_TEST_ACCOUNTS.md` (untracked, never commit it).
