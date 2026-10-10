import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'

import {
  allocateDatabaseName,
  allocateE2eDatabaseUrl,
  clearTrackedDatabaseUrl,
  databaseNameFromUrl,
  readTrackedDatabaseUrl,
  resetE2eDatabaseAllocation,
} from './database-url.ts'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-db-'))

afterEach(() => {
  clearTrackedDatabaseUrl()
  resetE2eDatabaseAllocation()
  delete process.env.E2E_DATABASE_URL
  delete process.env.E2E_DATABASE_NAME
  delete process.env.DATABASE_URL
  delete process.env.E2E_DATABASE_URL_FILE
})

function useFile(): string {
  const file = path.join(dir, `${process.pid}-${Math.random().toString(16).slice(2)}.url`)
  process.env.E2E_DATABASE_URL_FILE = file
  return file
}

test('allocate requires the e2e prefix and rejects non-test names', () => {
  for (const stem of ['latest', 'contest_prod', 'xlocale', 'xlocale_test', 'production']) {
    assert.throws(() => allocateDatabaseName(stem, 'xlocale'), /xlocale_e2e_/)
  }
})

test('allocate refuses the application database name', () => {
  assert.throws(() => allocateDatabaseName('xlocale_e2e_app', 'xlocale_e2e_app'), /application database/)
})

test('allocate appends a unique suffix under the identifier limit', () => {
  const first = allocateDatabaseName('xlocale_e2e_run', 'xlocale')
  const second = allocateDatabaseName('xlocale_e2e_run', 'xlocale')
  assert.ok(first.startsWith('xlocale_e2e_run_'))
  assert.ok(second.startsWith('xlocale_e2e_run_'))
  assert.notEqual(first, second)
  assert.ok(first.length <= 63)
  const fitted = allocateDatabaseName(`xlocale_e2e_${'a'.repeat(80)}`, 'xlocale')
  assert.ok(fitted.startsWith('xlocale_e2e_'))
  assert.ok(fitted.length <= 63)
})

test('the run records one URL and teardown does not re-read the environment', () => {
  useFile()
  process.env.DATABASE_URL = 'postgresql://localhost/xlocale'
  process.env.E2E_DATABASE_URL = 'postgresql://localhost/xlocale_e2e_stem'
  const url = allocateE2eDatabaseUrl()
  const name = databaseNameFromUrl(url)
  assert.ok(name.startsWith('xlocale_e2e_stem_'))
  assert.notEqual(name, 'xlocale')
  process.env.E2E_DATABASE_URL = 'postgresql://localhost/xlocale_e2e_other'
  process.env.DATABASE_URL = 'postgresql://localhost/production'
  resetE2eDatabaseAllocation()
  assert.equal(allocateE2eDatabaseUrl(), url)
  assert.equal(readTrackedDatabaseUrl(), url)
  clearTrackedDatabaseUrl()
  assert.equal(readTrackedDatabaseUrl(), null)
})

test('a missing tracking file drops nothing even when the environment names a database', () => {
  useFile()
  process.env.E2E_DATABASE_URL = 'postgresql://localhost/xlocale'
  process.env.DATABASE_URL = 'postgresql://localhost/xlocale'
  assert.equal(readTrackedDatabaseUrl(), null)
})

test('setup creates a new database and teardown reads only the tracked file', () => {
  const setup = fs.readFileSync(new URL('./global-setup.ts', import.meta.url), 'utf8')
  const teardown = fs.readFileSync(new URL('./global-teardown.ts', import.meta.url), 'utf8')
  assert.match(setup, /create-new/)
  assert.match(setup, /readTrackedDatabaseUrl/)
  assert.doesNotMatch(setup, /postgres_admin create /)
  assert.match(setup, /clearTrackedDatabaseUrl/)
  assert.match(teardown, /readTrackedDatabaseUrl/)
  assert.doesNotMatch(teardown, /e2eDatabaseUrl\(/)
  assert.doesNotMatch(teardown, /allocateE2eDatabaseUrl\(/)
})
