import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.data')

const DEFAULT_BASE = 'postgresql+psycopg://xlocale:xlocale@localhost:5432/xlocale'
const PREFIX = 'xlocale_e2e_'
const MAX_IDENT = 63
const NAME_OK = /^[A-Za-z0-9_]+$/

let allocatedUrl: string | null = null

function redactDatabaseUrl(url: string): string {
  try {
    const driver = url.startsWith('postgresql+psycopg:') ? 'postgresql+psycopg:' : 'postgresql:'
    const parsed = new URL(url.replace(/^postgresql\+psycopg:/, 'postgresql:'))
    if (parsed.password) parsed.password = '***'
    const rendered = parsed.toString().replace(/\/$/, '')
    return rendered.replace(/^postgresql:/, driver)
  } catch {
    return url.replace(/:([^:@/]+)@/, ':***@')
  }
}

export function databaseNameFromUrl(url: string): string {
  const match = url.match(/^(.*\/)([^/?]+)(\?.*)?$/)
  if (!match?.[2]) {
    throw new Error(`Cannot derive a database name from ${redactDatabaseUrl(url)}`)
  }
  return match[2]
}

function withDatabaseName(base: string, name: string): string {
  const match = base.match(/^(.*\/)([^/?]+)(\?.*)?$/)
  if (!match) {
    throw new Error(`Cannot derive a database name from ${redactDatabaseUrl(base)}`)
  }
  return `${match[1]}${name}${match[3] ?? ''}`
}

function trackingFile(): string {
  const fromEnv = process.env.E2E_DATABASE_URL_FILE?.trim()
  if (fromEnv) return fromEnv
  const file = path.join(dataDir, `database-url-${process.pid}`)
  process.env.E2E_DATABASE_URL_FILE = file
  return file
}

function postgresUrl(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.startsWith('postgres') ? trimmed : null
}

/**
 * Build a database name this run will create.
 *
 * `stem` must start with `xlocale_e2e_` and must not be the application database.
 * A unique suffix is always appended. `suffix` includes the leading `_` when tests
 * pin it; otherwise a random suffix is used.
 */
export function allocateDatabaseName(stem: string, appName: string, suffix?: string): string {
  if (!NAME_OK.test(stem)) {
    throw new Error(`Refusing database name ${JSON.stringify(stem)}.`)
  }
  if (!stem.startsWith(PREFIX)) {
    throw new Error(
      `Refusing database name ${JSON.stringify(stem)}. Harness databases must start with ${JSON.stringify(PREFIX)}.`,
    )
  }
  if (stem === appName) {
    throw new Error(`Refusing the application database name ${JSON.stringify(stem)}.`)
  }
  const extra = suffix ?? `_${crypto.randomUUID().replaceAll('-', '')}`
  if (!/^_[A-Za-z0-9_]+$/.test(extra)) {
    throw new Error(`Refusing database suffix ${JSON.stringify(extra)}.`)
  }
  let base = stem
  if (base.length + extra.length > MAX_IDENT) {
    base = base.slice(0, MAX_IDENT - extra.length)
  }
  if (!base.startsWith(PREFIX)) {
    throw new Error(
      `Refusing database name ${JSON.stringify(stem)}. The ${PREFIX} prefix does not fit in ${MAX_IDENT} characters.`,
    )
  }
  const name = `${base}${extra}`
  if (name === appName) {
    throw new Error(`Refusing the application database name ${JSON.stringify(name)}.`)
  }
  return name
}

/** Allocate this run's URL and record it. Later calls in this process return the same URL. */
export function allocateE2eDatabaseUrl(): string {
  if (allocatedUrl) return allocatedUrl
  const configured = postgresUrl(process.env.DATABASE_URL)
  const fromEnv = postgresUrl(process.env.E2E_DATABASE_URL)
  const server = fromEnv ?? configured ?? DEFAULT_BASE
  const appName = databaseNameFromUrl(configured ?? DEFAULT_BASE)
  const stem = fromEnv
    ? databaseNameFromUrl(fromEnv)
    : process.env.E2E_DATABASE_NAME?.trim() || PREFIX
  const name = allocateDatabaseName(stem, appName)
  const url = withDatabaseName(server, name)
  const file = trackingFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, url)
  allocatedUrl = url
  return url
}

/** The URL this run recorded. Does not allocate and does not read the environment. */
export function readTrackedDatabaseUrl(): string | null {
  const file = process.env.E2E_DATABASE_URL_FILE?.trim()
  if (!file || !fs.existsSync(file)) return null
  const text = fs.readFileSync(file, 'utf8').trim()
  return text || null
}

export function clearTrackedDatabaseUrl(): void {
  allocatedUrl = null
  const file = process.env.E2E_DATABASE_URL_FILE?.trim()
  if (file && fs.existsSync(file)) fs.unlinkSync(file)
}

/** @internal Test hook so one process can allocate more than one run. */
export function resetE2eDatabaseAllocation(): void {
  allocatedUrl = null
}

/** @deprecated Config loads `allocateE2eDatabaseUrl`. Other processes must read the tracked file. */
export function e2eDatabaseUrl(): string {
  return readTrackedDatabaseUrl() ?? allocateE2eDatabaseUrl()
}
