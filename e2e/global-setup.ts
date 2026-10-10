import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { clearTrackedDatabaseUrl, readTrackedDatabaseUrl } from './database-url'

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

function admin(action: 'sweep' | 'create-new' | 'drop', databaseUrl: string, env: NodeJS.ProcessEnv) {
  execSync(`uv run python -m app.postgres_admin ${action} ${JSON.stringify(databaseUrl)}`, {
    cwd: path.join(repoRoot, 'backend'),
    env,
    stdio: 'inherit',
  })
}

export default async function globalSetup() {
  const databaseUrl = readTrackedDatabaseUrl()
  if (!databaseUrl) {
    throw new Error('Playwright did not record a database URL for this run.')
  }
  const env = e2eEnv(databaseUrl)
  try {
    admin('sweep', databaseUrl, env)
    admin('create-new', databaseUrl, env)
  } catch (error) {
    // create-new failed, so this run did not create the database. Do not drop it.
    clearTrackedDatabaseUrl()
    throw error
  }
  try {
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
  } catch (error) {
    try {
      admin('drop', databaseUrl, env)
    } finally {
      clearTrackedDatabaseUrl()
    }
    throw error
  }
}
