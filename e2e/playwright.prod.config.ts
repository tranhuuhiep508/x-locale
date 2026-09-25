// Smoke test the built frontend served by FastAPI on one origin.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const port = Number(process.env.E2E_BACKEND_PORT ?? 8001)
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  globalSetup: path.join(here, 'global-setup.ts'),
  projects: [{ name: 'chromium-prod', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `uv run uvicorn app.main:app --host 127.0.0.1 --port ${port}`,
    cwd: path.join(root, 'backend'),
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      DATABASE_URL: `sqlite:///${path.join(here, '.data', 'e2e.db')}`,
      AUTH_DEV_BYPASS: 'true',
      OIDC_ISSUER: '',
      OIDC_CLIENT_ID: '',
      OIDC_CLIENT_SECRET: '',
      X_LOCALE_SECRET: 'e2e-test-secret',
      X_LOCALE_DEMO_API_KEY: 'demo-api-key-e2e',
      AI_TRANSLATE_STUB: 'true',
      STATIC_DIR: path.join(root, 'frontend', 'dist'),
    },
  },
})
