import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { clearTrackedDatabaseUrl, readTrackedDatabaseUrl } from './database-url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export default async function globalTeardown() {
  const databaseUrl = readTrackedDatabaseUrl()
  if (!databaseUrl) return
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
