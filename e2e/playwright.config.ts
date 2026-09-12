import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const dbPath = path.join(__dirname, '.data', 'e2e.db')

const e2eEnv = {
  DATABASE_URL: `sqlite:///${dbPath}`,
  AUTH_DEV_BYPASS: 'true',
  OIDC_ISSUER: '',
  OIDC_CLIENT_ID: '',
  OIDC_CLIENT_SECRET: '',
  X_LOCALE_SECRET: process.env.X_LOCALE_SECRET ?? 'e2e-test-secret',
  X_LOCALE_DEMO_API_KEY: process.env.X_LOCALE_DEMO_API_KEY ?? 'demo-api-key-e2e',
  AI_TRANSLATE_STUB: 'true',
  AI_TRANSLATE_STUB_DELAY_MS: '400',
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  globalSetup: path.join(__dirname, 'global-setup.ts'),
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'uv run uvicorn app.main:app --host 127.0.0.1 --port 8000',
      cwd: path.join(repoRoot, 'backend'),
      url: 'http://127.0.0.1:8000/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: e2eEnv,
    },
    {
      command: 'npm run dev',
      cwd: path.join(repoRoot, 'frontend'),
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        VITE_API_PROXY_TARGET: 'http://127.0.0.1:8000',
      },
    },
  ],
})
