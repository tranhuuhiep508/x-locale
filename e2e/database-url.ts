import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.data')

const DEFAULT_BASE = 'postgresql+psycopg://xlocale:xlocale@localhost:5432/xlocale'
const PREFIX = 'xlocale_e2e_'
const MAX_IDENT = 63
const NAME_OK = /^[A-Za-z0-9_]+$/

/** URL globalSetup recorded after create-new. Teardown must match its host, port, and name. */
export const CREATED_DATABASE_ENV = 'XLOCALE_E2E_CREATED_DATABASE'

let allocatedUrl: string | null = null
let createdTrackingFile: string | null = null

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
  return databaseEndpoint(url).name
}

/** Host, port, and database name. An omitted port is 5432. */
export function databaseEndpoint(url: string): { host: string; port: string; name: string } {
  let parsed: URL
  try {
    parsed = new URL(url.replace(/^postgresql\+psycopg:/, 'postgresql:'))
  } catch {
    throw new Error(`Cannot derive a database name from ${redactDatabaseUrl(url)}`)
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  if (!name || parsed.protocol !== 'postgresql:') {
    throw new Error(`Cannot derive a database name from ${redactDatabaseUrl(url)}`)
  }
  return { host: parsed.hostname, port: parsed.port || '5432', name }
}

function withDatabaseName(base: string, name: string): string {
  const match = base.match(/^(.*\/)([^/?]+)(\?.*)?$/)
  if (!match) {
    throw new Error(`Cannot derive a database name from ${redactDatabaseUrl(base)}`)
  }
  return `${match[1]}${name}${match[3] ?? ''}`
}

function defaultTrackingFile(): string {
  return path.join(dataDir, `database-url-${process.pid}`)
}

function trackingFile(): string {
  const fromEnv = process.env.E2E_DATABASE_URL_FILE?.trim()
  if (fromEnv) return fromEnv
  const file = defaultTrackingFile()
  createdTrackingFile = file
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
 * The name is `{stem}_{epoch}_{hex}` after one trailing underscore is removed, so
 * the default stem does not become `xlocale_e2e__`.
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
  const epoch = Math.floor(Date.now() / 1000).toString()
  const extra = suffix ?? `_${epoch}_${crypto.randomUUID().replaceAll('-', '')}`
  if (!/^_[A-Za-z0-9_]+$/.test(extra)) {
    throw new Error(`Refusing database suffix ${JSON.stringify(extra)}.`)
  }
  let base = stem.endsWith('_') ? stem.slice(0, -1) : stem
  if (base.length + extra.length > MAX_IDENT) {
    base = base.slice(0, MAX_IDENT - extra.length)
  }
  if (!base.startsWith(PREFIX.slice(0, -1))) {
    throw new Error(
      `Refusing database name ${JSON.stringify(stem)}. The ${PREFIX} prefix does not fit in ${MAX_IDENT} characters.`,
    )
  }
  const name = `${base}${extra}`
  if (name.includes('__') || name === appName) {
    throw new Error(`Refusing database name ${JSON.stringify(name)}.`)
  }
  return name
}

/**
 * Allocate this run's URL and record it.
 *
 * Playwright loads the config in each worker. A worker must reuse the URL the
 * first process recorded. Allocating again would point seed and the app at a
 * database global-setup never created.
 */
export function allocateE2eDatabaseUrl(): string {
  if (allocatedUrl) return allocatedUrl
  const recorded = readTrackedDatabaseUrl()
  if (recorded) {
    allocatedUrl = recorded
    return recorded
  }
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
  if (!file) return
  const owned = file === createdTrackingFile || file === defaultTrackingFile()
  if (owned && fs.existsSync(file)) fs.unlinkSync(file)
}

/**
 * Teardown may drop only the database globalSetup recorded.
 *
 * The tracked name must use the `xlocale_e2e_` prefix, must not be the application
 * database, and its host, port, and name must equal the URL stored in
 * `XLOCALE_E2E_CREATED_DATABASE`.
 */
export function assertTeardownDatabase(
  url: string,
  appUrl: string | undefined,
  createdUrl: string | undefined,
): string {
  const tracked = databaseEndpoint(url)
  const name = tracked.name
  if (!NAME_OK.test(name) || !name.startsWith(PREFIX)) {
    throw new Error(`Refusing tracked database ${JSON.stringify(name)}.`)
  }
  const configured = appUrl?.trim() ?? ''
  if (configured.startsWith('postgres')) {
    const appName = databaseNameFromUrl(configured)
    if (name === appName) {
      throw new Error(`Refusing the application database name ${JSON.stringify(name)}.`)
    }
  }
  if (!createdUrl) {
    throw new Error(
      `Refusing tracked database ${JSON.stringify(name)}. It does not match the database this run created.`,
    )
  }
  const created = databaseEndpoint(createdUrl)
  if (tracked.host !== created.host || tracked.port !== created.port || name !== created.name) {
    throw new Error(
      `Refusing tracked database ${JSON.stringify(name)} on ${tracked.host}:${tracked.port}. It does not match the database this run created.`,
    )
  }
  return name
}

/** @internal Test hook so one process can allocate more than one run. */
export function resetE2eDatabaseAllocation(): void {
  allocatedUrl = null
}

/** @deprecated Config loads `allocateE2eDatabaseUrl`. Other processes must read the tracked file. */
export function e2eDatabaseUrl(): string {
  return readTrackedDatabaseUrl() ?? allocateE2eDatabaseUrl()
}
