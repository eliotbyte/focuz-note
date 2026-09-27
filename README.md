# Focuz API

Backend API for a note-taking application with workspaces, notes, charts, and activities.

**Status**: alpha  
**Version**: 0.1.0-alpha

## Quick Start

1. Create a `.env` file in the project root:
```env
POSTGRES_USER=focuz_user
POSTGRES_PASSWORD=focuz_password
POSTGRES_DB=focuz_db
JWT_SECRET=your_secret_key_here
MINIO_EXTERNAL_ENDPOINT=http://localhost:9000
MINIO_EXTERNAL_USE_SSL=false
```

2. Start the project:
```bash
docker-compose up -d
```

3. The API will be available at: http://localhost:8080
4. API documentation (Swagger UI): http://localhost:8081

## Project Structure

- `main.go` - application entry point
- `handlers/` - HTTP handlers
- `models/` - data models
- `repository/` - data access layer
- `migrations/` - database migrations
- `middleware/` - middleware (CORS, authentication)
- `initializers/` - service initializers
- `types/` - data types
- `tests/` - tests

## API Endpoints

### Authentication
- `POST /register` - user registration
- `POST /login` - user login

### Workspaces (Spaces)
Roles: **owner** (creator; everything, incl. deleting the space), **admin** (members, invitations,
renaming, publishing), **editor** (writes notes, edits any note, deletes own), **guest** (read-only).
A space created with `"personal": true` is the user's private space (one per user): it can't be
shared, made public as a whole or deleted. Folders (saved filters) are personal to each member.

- `GET /spaces` - spaces I am in; `POST /spaces` `{name, personal?}` - create
- `PATCH /spaces/{id}` `{name}` (admin) · `PATCH /spaces/{id}/delete` (owner) · `PATCH /spaces/{id}/restore`
- `GET /spaces/{id}/members` - members (usernames and roles, never e-mails)
- `PATCH /spaces/{id}/members/{userId}` `{role}` - change a role (only the owner makes admins)
- `DELETE /spaces/{id}/members/{userId}` - remove someone, or leave when it is yourself
- `POST /spaces/{id}/invitations` `{identifier, role}` - invite by username (or e-mail on an e-mail
  server). The answer is identical whether or not the account exists; 20 invitations per hour per
  person. Invitations to an unknown address reach the account that confirms that address later.
- `GET /spaces/{id}/invitations` · `DELETE /spaces/{id}/invitations/{invitationId}` - pending ones (admin)
- `GET /invitations` · `POST /invitations/{id}/accept` · `POST /invitations/{id}/decline` - mine
- `POST /spaces/{id}/shares` `{noteId?, includeReplies}` - public read-only link to the space or a
  note (with its replies, all levels); `PATCH /shares/{token}` `{includeReplies}`; `DELETE /shares/{token}`
- `GET /public/{token}`, `GET /public/{token}/files/{fileId}` - no sign-in; only what the link covers

### Account & notifications
- `GET /me`, `PATCH /me` `{notifyEmail}`, `POST /me/password` `{currentPassword, newPassword}`
- `GET /notifications` (latest 50 + unread count), `POST /notifications/read` `{ids}` or `{all: true}`.
  Kinds: `space_invitation`, `invitation_accepted`, `role_changed`, `removed_from_space`, `space_deleted`.
  Open apps get a WebSocket ping; on e-mail servers they are also e-mailed when `notifyEmail` is on
  (link to the web app when `PUBLIC_WEB_URL` is set).
- `GET /notes/{id}/history` - author, last editor and the edit log (who and when)

### Notes
- `GET /notes` - get notes
- `POST /notes` - create a note
- `GET /notes/{id}` - get a note by ID
- `PATCH /notes/{id}/delete` - soft delete a note
- `PATCH /notes/{id}/restore` - restore a note
- `GET /tags/autocomplete` - tag autocomplete

### Activities
- `GET /activities` - get activity analysis
- `POST /activities` - create an activity
- `PATCH /activities/{id}` - update an activity
- `PATCH /activities/{id}/delete` - soft delete an activity
- `PATCH /activities/{id}/restore` - restore an activity

### Activity Types
- `GET /spaces/{spaceId}/activity-types` - get activity types
- `POST /spaces/{spaceId}/activity-types` - create an activity type
- `PATCH /spaces/{spaceId}/activity-types/{typeId}/delete` - soft delete an activity type
- `PATCH /spaces/{spaceId}/activity-types/{typeId}/restore` - restore an activity type

### Charts
- `GET /charts` - get charts
- `POST /charts` - create a chart
- `PATCH /charts/{id}` - update a chart
- `PATCH /charts/{id}/delete` - soft delete a chart
- `PATCH /charts/{id}/restore` - restore a chart
- `GET /chart-types` - get chart types
- `GET /period-types` - get period types

### Attachments
- `POST /upload` - upload a file
- `GET /files/{id}` - get a file

### Sync (Offline)

- `GET /sync?since=<RFC3339>&spaceId?=<id>` — pull changes since timestamp. Returns notes, tags, filters, charts, activities, spaces changed after `since`. Use for polling or after WS/SSE events.
- `POST /sync` — push local changes. Body contains arrays: `notes`, `tags`, `filters`, `charts`, `activities`. Server applies with last-write-wins by `modified_at` and returns `mappings` (clientId -> serverId) and `conflicts`.

Example pull:
```bash
curl -H "Authorization: Bearer <TOKEN>" \
     "http://localhost:8080/sync?since=2024-01-01T00:00:00Z"
```

Example push:
```bash
curl -X POST -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{
    "notes": [
      {
        "clientId": "tmp-123",
        "space_id": 1,
        "user_id": 1,
        "text": "Hello",
        "tags": ["important"],
        "created_at": "2025-01-01T10:00:00Z",
        "modified_at": "2025-01-01T10:00:00Z"
      }
    ],
    "tags": [], "filters": [], "charts": [], "activities": []
  }' \
  http://localhost:8080/sync
```

### Utilities by Space

- `GET /spaces/{spaceId}/tags` — list tags in space.
- `GET /spaces/{spaceId}/filters` — list filters in space (alias of `GET /filters?spaceId=...`).

## Filters

Saved note filters with nested grouping and JSON parameters.

- Create: POST `/filters` { spaceId, parentId?, name, params<object/json> }
- List: GET `/filters?spaceId=...&page=1&pageSize=20`
- Update: PATCH `/filters/{id}` { name?, parentId?, params? }
- Delete: PATCH `/filters/{id}/delete`
- Restore: PATCH `/filters/{id}/restore`

## Technologies

- **Go 1.24** - main language
- **Gin** - web framework
- **PostgreSQL** - database
- **PostgreSQL FTS (GIN + tsvector)** - optional full-text index (portable, no extensions required)
- **MinIO** - object storage
- **JWT** - authentication
- **Docker** - containerization

## Development

### Run tests
```bash
# Quick test run (PowerShell)
.\run-tests.ps1
```

### Local development
```bash
# Start only the database and MinIO
# Recommended:
 docker-compose up db minio -d

# Run the API locally
 go run main.go
```

### Environment notes
- `APP_ENV`: application runtime environment. Supported values: `production` and `test`.
  - In `test`, some protections/toggles are relaxed for faster test runs (e.g. rate limiting is disabled).
  - `/health` includes the effective `environment` value.
- `ALLOWED_ORIGINS`: comma-separated origins allowed in production for CORS and WebSocket (e.g. `https://app.example.com,https://staging.example.com`).
- `TRUSTED_PROXIES`: comma-separated proxy CIDRs or IPs for correct client IP; defaults to `127.0.0.1, ::1` when unset.
- `RATE_LIMIT_RPS`, `RATE_LIMIT_BURST`, `RATE_LIMIT_WHITELIST`, `RATE_LIMIT_ENABLED`: tune/disable rate limiting.
- `MINIO_EXTERNAL_ENDPOINT`: external hostname:port for presigned URLs; if empty, internal endpoint is used.
- `MINIO_EXTERNAL_USE_SSL`: optional bool for presigned URL scheme when using `MINIO_EXTERNAL_ENDPOINT`. If unset, inferred from the endpoint scheme (`http://`/`https://`) or falls back to `MINIO_USE_SSL`.

## API Documentation

Swagger UI is available at: http://localhost:8081

The documentation is automatically updated when the `openapi.yaml` file changes. 