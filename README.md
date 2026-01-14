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

