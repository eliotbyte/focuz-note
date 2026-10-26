# Focuz Web

Frontend for **focuz-note** (local-first notes).

**Status**: alpha  
**Version**: 0.3.1

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
- Documents (PDF, office, text, Markdown, CSV; up to 25 MB) upload through the same queue but are
  downloaded only when someone opens them; after that they stay in IndexedDB and open offline.
  Text, Markdown and CSV up to 1 MB, PDF (pdf.js, pages on canvas) and .docx (mammoth, then DOMPurify)
  can be read in the app; everything else is saved as a file. pdf.js and mammoth load only when such a
  file is opened; nginx serves the pdf.js worker (`.mjs`) as JavaScript.
- Text, Markdown and CSV files can be edited in their preview (by anyone who may edit the note).
  Saving uploads a new version in the same place and deletes the old one, so it works offline.
- Code blocks keep their language in the Markdown (```` ```csharp ````) and are highlighted with
  highlight.js (the grammars in `src/lib/code-languages.ts`; lowlight in the editors). Code pasted
  from VS Code keeps its language; code of 20+ lines pasted from a code editor or into a code block
  becomes an attached `Code (<language>).md`, with "Keep in text" in the toast. Long plain text
  (20+ lines or 1500+ characters) goes the same way, to a `.md` named after its first words.
- Search (FlexSearch, in the browser) covers the note text and tags; with the "search in file contents"
  switch in the search field it also covers the note's text, Markdown and CSV files. Sync fetches those
  in the background (up to 1 MB each; files pulled by older versions are fetched when the index is
  built); their text is indexed by word start, at most 200 000 characters per file. PDF and Word
  files are not searched.
- Conflicts (a note changed on two devices) keep the server version and save the local text as a
  separate note tagged `conflict`.
