import { defineConfig } from '@playwright/test'

// End-to-end tests against a running stack (web + api + db + minio), e.g. `docker compose up`.
//   E2E_WEB_URL=http://localhost:8081 E2E_API_URL=http://localhost:8080 npm run test:e2e
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: process.env.E2E_WEB_URL || 'http://localhost:8081',
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : undefined,
  },
})
