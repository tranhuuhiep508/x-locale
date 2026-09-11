import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const dataDir = path.join(__dirname, '.data')
const dbPath = path.join(dataDir, 'e2e.db')

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
    AI_TRANSLATE_STUB: 'true',
    AI_TRANSLATE_STUB_DELAY_MS: '400',
  }
}

export default async function globalSetup() {
  fs.mkdirSync(dataDir, { recursive: true })
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath)
  }

  const env = e2eEnv()
  execSync('uv run alembic upgrade head', {
    cwd: path.join(repoRoot, 'backend'),
    env,
    stdio: 'inherit',
  })
  execSync('uv run python -m app.cli seed-demo --force', {
    cwd: path.join(repoRoot, 'backend'),
    env,
    stdio: 'inherit',
  })
}
