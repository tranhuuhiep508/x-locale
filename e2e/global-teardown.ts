import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CREATED_DATABASE_ENV,
  assertTeardownDatabase,
  clearTrackedDatabaseUrl,
  readTrackedDatabaseUrl,
} from './database-url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export default async function globalTeardown() {
  const databaseUrl = readTrackedDatabaseUrl()
  if (!databaseUrl) return
  assertTeardownDatabase(databaseUrl, process.env.DATABASE_URL, process.env[CREATED_DATABASE_ENV])
  try {
    execSync(`uv run python -m app.postgres_admin drop ${JSON.stringify(databaseUrl)}`, {
      cwd: path.join(repoRoot, 'backend'),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    })
  } finally {
    clearTrackedDatabaseUrl()
  }
}
