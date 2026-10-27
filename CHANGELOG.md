# Changelog

Versions before 0.2.0 were not tagged. From 0.2.0 on, each release has a `vX.Y.Z` tag, and every
commit to `main` raises the patch number.

## 0.4.0 (2026-10-27)

Agents work with files and organise spaces, the feed holds thousands of notes, and sync stays quiet
unless something needs you. Status: still alpha.

### Agents (MCP)

- Files: `attach_files` (text files as text, small files as base64), `create_note` takes files (also
  without text), `get_upload_link` (a signed 15-minute link for one note to post a file from disk with
  `curl -F file=@...`), `get_file` (a picture comes back as an image, a text file as text, any file with
  a 15-minute download link), `delete_file`. JPEG and PNG are accepted next to WebP.
- Organising: `create_space`, `rename_space`, `delete_space`, `restore_space`; `create_folder`,
  `update_folder`, `delete_folder`, `restore_folder`; `list_notes` with `inTrash`.
- `update_note` moves a note into a thread or out of one (`parentId`).
- Note tools take `noteId` as well as `id`.

### Notes and the feed

- Notes move between threads: ⋮ → "Move to thread…" and "Detach from thread", with Undo; replies move
  with the note. REST: `PATCH /notes/:id` with `parentId`.
- Thousands of notes: the feed shows 40 notes and adds more as you scroll, and the search index is
  rebuilt in the background. Signing in on an empty device with 2900 notes no longer freezes the tab
  (longest block 5.2 s → 0.14 s). Pictures load lazily and download one after another with a gap.
- Pictures: the short side must be at least 64 px (was 480), the long side up to 8 times the short one
  (was 2.4), at most 8000 px. Previews crop long pictures; the viewer scrolls along them. Small pictures
  are not enlarged.
- Note cards put the footer (author, date, ⋮) at the end of the last line when it fits.

### Sync

- The status chip in the top bar shows only while notes cannot reach the server: Offline, No
  connection, Not syncing, Signed out. When everything syncs there is no chip. Sync details and
  "Sync now" are in Settings → About.
- No "N failed" counter: transfers are retried for as long as it takes. A file the server refuses is
  marked on the file itself, with the reason and "Remove" / "Try again" (uploads) or "Try again"
  (a picture the server does not have).
- The pull checkpoint comes from the server clock (`syncedAt`), so a record dated in the future no
  longer hides later changes; a client stuck on such a checkpoint gets everything again.
- Times with an offset (`+03:00`) keep the instant they name.
- `/sync` refuses metric values that are not `{"data": <value of the metric's type>}`
  (reason `invalid_value`); such values used to break the metric tools.

### Fixes

- A deleted space stayed readable and writable for its members; now it is gone until restored.
- `PATCH /filters/:id` without `parentId` moved the folder to the top level; it now keeps its place.
- File links behind a proxy that serves the API under a path (`/api`) missed the path.
- Display: native select lists in the dark theme, the header covering the feed's scrollbar, tags stuck
  to file chips.

### Upgrading from 0.3.x

- Migration `000010_timestamptz` converts every timestamp column to `TIMESTAMPTZ` (stored values were
  UTC and stay the same instants). It rewrites the tables, so large databases take a moment on start.
- Notes from REST and MCP no longer carry a presigned storage `url` for attachments; read files with
  `get_file` or `GET /files/{id}/content`.
- Behind a reverse proxy, set `PUBLIC_API_URL` (or have the proxy send `X-Forwarded-Host`,
  `X-Forwarded-Proto` and `X-Forwarded-Prefix`), or agents' file links point to the wrong address.
  The API logs a note at startup while it is unset.
- Web: transfers an older version gave up on are queued again once. Rebuild both images.

### Known gaps

- Still no charts in the app, and no token form in the web app (tokens: `POST /me/api-tokens`).
- No sign-in through OAuth for the claude.ai connector screen yet.

## 0.3.0 (2026-10-26)

Metrics, and an agent that can use the notes as its memory. Status: still alpha.

### Metrics

- A metric is a number tracked over time: weight, a blood value, spending, sleep. Each value lives in
  a note and takes the note's date, so the feed shows what was recorded and when.
- **Metrics** in the sidebar: every metric of the space with its last value and the change since the
  one before; an open metric lists all its values (day, value, change, note) and opens their notes,
  with lowest, highest and average for numbers. Metrics that add up (spending, steps) show no change.
- The composer has a metric button (new notes and replies too, not only edits) with the space's
  metrics and “New metric…”: name, kind of value (number, whole number, duration, yes/no, text), unit,
  and whether a period shows the average or the total. Note pills show the unit (“Weight: 63 kg”).
- REST: `GET/POST /spaces/:spaceId/metrics`, `GET /spaces/:spaceId/metrics/:metric/entries`
  (`from`, `to`, `limit`, `order`, `groupBy=day|week|month|year`), `POST /metrics/record`.

### Agents (MCP)

- New tools: `describe_space` (tags with counts, folders, metrics with last values), `list_metrics`,
  `create_metric`, `record_metrics` (saves values in a dated note and answers with the previous value
  and the change), `get_metric_history` (values and stats, or one value per day/week/month/year),
  `remove_metric_value`, `restore_note`.
- `list_notes` searches the text (`query`: every word, any case); `get_note` can include replies; a
  note's metric values carry the metric's name. The server instructions describe the workflow.

### Also since 0.2.0

- Export: Telegram-style options (pictures and files are separate choices, only the chosen kind is
  downloaded), and a date picker for the range and the note date instead of the browser's input.
- Uploads: a 429 no longer uses up a file's attempts; other refusals fail at once. Import skips
  pictures the server would refuse and says so.
- REST, MCP and public links list a note's files in their order, as sync does.

### Upgrading from 0.2.x

- No migrations and no new settings. Rebuild both images.
- Editors can now create metrics in a shared space (`POST /spaces/:id/metrics`); deleting them still
  needs an admin. The older `POST /spaces/:id/activity-types` is unchanged.
- A `time` value sent to `POST /activities` or `PATCH /activities/:id` is now a duration (`7h30m`,
  `7:30` or `7 hours 30 minutes`), stored as the web app stores it. The old RFC 3339 form could not be
  aggregated and is refused.

### Known gaps

- No charts in the app yet; `get_metric_history` with `groupBy` gives the data for them.
- A value is attached with the button, not recognised from the text (“weight 63 kg”).
- Creating a metric needs a connection to the server; adding values works offline.

## 0.2.0 (2026-10-26)

Everything since the first alpha, 0.1.0 (2026-01-14). Status: still alpha.

### Notes

- Notes are Markdown (GFM). The composer and the full-screen editor are the same rich editor
  (tiptap): typing `**bold**`, `~~strike~~` or `[ ] ` becomes formatting, and selecting text shows a
  formatting bar. Checklist items can be ticked in the feed. Old plain-text notes look as before and
  change only when edited.
- Code blocks have a language and are highlighted (highlight.js, 22 grammars). Code pasted from
  VS Code keeps its language. Long pasted code (20+ lines) or text (20+ lines or 1500+ characters)
  goes into an attached Markdown file; "Keep in text" puts it back.
- Notes can have a date of their own; the feed shows relative time with the full date in a tooltip,
  and an opened note shows its date.
- A note or a reply can have only pictures and no text.

### Pictures and files

- Pictures in notes: two or three are packed together, four or more become a carousel; their order
  is kept through upload. An image editor flips, rotates and crops a picture before posting.
  Avatars and space pictures.
- Documents next to pictures: PDF, Word, Excel, PowerPoint, OpenDocument, RTF, text, Markdown and CSV,
  with their own size limit (`MAX_DOCUMENT_SIZE`, 25 MB). Types are checked by content.
- PDF and Word files open in the app (pdf.js, mammoth + DOMPurify); text, Markdown and CSV have a
  preview, and anyone who may edit the note can edit them there (saved as a new version).
- Search can look inside a note's text files (a switch in the search field, off by default).
- Deleting a picture removes its file from storage; at startup the API removes files left without an
  attachment (`ORPHAN_FILE_SWEEP=off` turns that off).

### Feed and folders

- Saved filters are folders, with icons, colours, subfolders and a filter bar above the feed.
  Task states and replies filter like tags.
- The feed stays as it was opened: edits and synced notes no longer move or hide notes, and returning
  to the feed lands where it was. Notes can be shown as same-size tiles, with the size saved per folder.

### Shared spaces

- Shared spaces with roles (owner, admin, editor, guest), invitations by username or e-mail,
  notifications under the bell and by e-mail, and note history (who changed a note and when).
- Public read-only links to a note (with or without its replies) or to a whole space.

### Sync and offline

- A new sync engine: atomic, idempotent pushes, conflicts by base version, items the server rejects
  are dropped instead of retried forever, one sync across browser tabs.
- A sync mark only on notes that are not on the server yet; a status chip explains what sync is doing.
- New web builds reach open and installed apps.

### Accounts

- New sign-in and sign-up screens; the web app can connect to another server
  (`VITE_ALLOW_CUSTOM_SERVER=false` locks it to its own).
- Optional e-mail accounts with confirmation codes (`AUTH_MODE=email`, `SMTP_*`), and
  `REGISTRATION=closed` for private instances.
- Personal API tokens (`fct_…`, Settings → Agents) with read or write scope, for scripts and agents;
  an MCP endpoint at `/mcp` for Claude Code and other MCP clients; `PATCH` for notes.

### Data

- Export and import of a space's notes, pictures and files. Export runs in the background with a
  progress panel, and asks what to do with pictures it cannot download.

### Look

- A redesign described in `DESIGN.md`: one set of tokens and materials, shared dialogs, menus and
  tooltips, a pass over accessibility (labels, focus, screen reader states).

### Security

- An October security assessment closed: no secret defaults in compose; the API refuses short or
  published `JWT_SECRET` values and makes one itself when it is empty; `TRUSTED_PROXIES` and
  `RATE_LIMIT_WHITELIST` are empty by default; guests are read-only everywhere; MinIO is private and
  files go through the API; e-mail sign-ups can't be taken over; changing a password signs out every
  session and revokes API tokens; the WebSocket token is no longer in the URL; the web app sends a CSP
  and other security headers; 500 responses no longer carry database errors.
- Dependencies: `golang.org/x/net` 0.60.0 (HTTP/2 server fixes GO-2026-6603, -6611, -6612, -6617),
  `golang.org/x/crypto` 0.57.0, `markdown-it` 15.0.3; build images on supported Go and Node versions.
  `govulncheck` and `npm audit --omit=dev` are clean.

### Upgrading from 0.1.0

- Read `CLAUDE.md` → "Deploying" first. Compose no longer has default secrets: set
  `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` and `POSTGRES_PASSWORD` in `.env`. `JWT_SECRET` may stay
  empty; a published example value stops the API from starting. A new secret signs everyone out.
- `TRUSTED_PROXIES` and `RATE_LIMIT_WHITELIST` are now empty by default. Behind a reverse proxy, set
  `TRUSTED_PROXIES` to its address.
- `ALLOWED_FILE_TYPES` empty means the built-in policy (pictures and the document types above).
- Migrations `000002`–`000009` run on start and keep existing data. `000004_sharing` makes invited
  "guests" (who could write before) editors and moves pending invitations to the new invitations
  table. `000006` numbers existing pictures in their current order.
- The API needs Go 1.26 or newer to build outside Docker (the image uses Go 1.27).
- The web app's IndexedDB is upgraded in place on first open; unsynced changes are pushed afterwards.

### Known gaps

- Export and import do not include folders, charts or the space's activity types yet.
- The MCP endpoint has no `restore_note` tool and works with a Bearer token only (no OAuth, so no
  claude.ai connector yet).
- Browser end-to-end tests do not cover documents, PDF/Word preview, API tokens or import.
