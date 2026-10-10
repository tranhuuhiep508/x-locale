import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { e2eDatabaseUrl } from './database-url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function e2eEnv(databaseUrl: string) {
  return {
    ...process.env,
    DATABASE_URL: databaseUrl,
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
  const databaseUrl = e2eDatabaseUrl()
  const env = e2eEnv(databaseUrl)
  const backend = path.join(repoRoot, 'backend')
  execSync(`uv run python -m app.postgres_admin create ${JSON.stringify(databaseUrl)}`, {
    cwd: backend,
    env,
    stdio: 'inherit',
  })
  execSync('uv run alembic upgrade head', {
    cwd: backend,
    env,
    stdio: 'inherit',
  })
  execSync('uv run python -m app.cli seed-demo --force', {
    cwd: backend,
    env,
    stdio: 'inherit',
  })
}
