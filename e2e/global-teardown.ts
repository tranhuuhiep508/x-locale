import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { e2eDatabaseUrl, e2eDatabaseUrlFile } from './database-url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export default async function globalTeardown() {
  const databaseUrl = e2eDatabaseUrl()
  execSync(`uv run python -m app.postgres_admin drop ${JSON.stringify(databaseUrl)}`, {
    cwd: path.join(repoRoot, 'backend'),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  })
  const urlFile = e2eDatabaseUrlFile()
  if (fs.existsSync(urlFile)) {
    fs.unlinkSync(urlFile)
  }
}
