import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.data')
const urlFile = path.join(dataDir, 'database-url')

const DEFAULT_BASE = 'postgresql+psycopg://xlocale:xlocale@localhost:5432/xlocale'

function withDatabaseName(base: string, name: string): string {
  const match = base.match(/^(.*\/)([^/?]+)(\?.*)?$/)
  if (!match) {
    throw new Error(`Cannot derive a database name from ${base}`)
  }
  return `${match[1]}${name}${match[3] ?? ''}`
}

/** One Postgres URL for this Playwright run, shared by config, setup, and specs. */
export function e2eDatabaseUrl(): string {
  const fromEnv = process.env.E2E_DATABASE_URL?.trim()
  if (fromEnv) {
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(urlFile, fromEnv)
    return fromEnv
  }
  if (fs.existsSync(urlFile)) {
    const existing = fs.readFileSync(urlFile, 'utf8').trim()
    if (existing) return existing
  }
  const base = process.env.DATABASE_URL?.trim().startsWith('postgres')
    ? process.env.DATABASE_URL.trim()
    : DEFAULT_BASE
  const name =
    process.env.E2E_DATABASE_NAME?.trim() ||
    `xlocale_e2e_${Date.now().toString(36)}${Math.random().toString(16).slice(2, 10)}`
  const url = withDatabaseName(base, name)
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(urlFile, url)
  return url
}

export function e2eDatabaseUrlFile(): string {
  return urlFile
}
