# Changelog

Versions before 0.2.0 were not tagged. From 0.2.0 on, each release has a `vX.Y.Z` tag, and every
commit to `main` raises the patch number.

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
