import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')
const dbPath = path.join(__dirname, '..', '.data', 'e2e.db')

function e2eEnv() {
  return {
    ...process.env,
    DATABASE_URL: `sqlite:///${dbPath}`,
    AUTH_DEV_BYPASS: 'true',
    OIDC_ISSUER: '',
    OIDC_CLIENT_ID: '',
    OIDC_CLIENT_SECRET: '',
    X_LOCALE_SECRET: process.env.X_LOCALE_SECRET ?? 'e2e-test-secret',
    X_LOCALE_DEMO_API_KEY: process.env.X_LOCALE_DEMO_API_KEY ?? 'demo-api-key-e2e',
  }
}

/** Re-seed the Demo App on the isolated E2E SQLite database. */
export function resetDemoDatabase() {
  execSync('uv run python -m app.cli seed-demo --force', {
    cwd: path.join(repoRoot, 'backend'),
    env: e2eEnv(),
    stdio: 'inherit',
  })
}
