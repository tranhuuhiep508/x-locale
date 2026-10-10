import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'

import {
  CREATED_DATABASE_ENV,
  allocateDatabaseName,
  allocateE2eDatabaseUrl,
  assertTeardownDatabase,
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
  delete process.env[CREATED_DATABASE_ENV]
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
  assert.match(first, /^xlocale_e2e_run_[0-9]{10}_[0-9a-f]+$/)
  assert.match(second, /^xlocale_e2e_run_[0-9]{10}_[0-9a-f]+$/)
  assert.notEqual(first, second)
  assert.ok(first.length <= 63)
  const fitted = allocateDatabaseName(`xlocale_e2e_${'a'.repeat(80)}`, 'xlocale')
  assert.ok(fitted.startsWith('xlocale_e2e_'))
  assert.ok(fitted.length <= 63)
  assert.equal(fitted.includes('__'), false)
})

test('the default stem does not produce a double underscore', () => {
  const name = allocateDatabaseName('xlocale_e2e_', 'xlocale')
  assert.match(name, /^xlocale_e2e_[0-9]{10}_[0-9a-f]+$/)
  assert.equal(name.includes('__'), false)
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
  assert.equal(readTrackedDatabaseUrl(), url)
})

test('clearing a run-owned tracking file removes it', () => {
  delete process.env.E2E_DATABASE_URL_FILE
  process.env.DATABASE_URL = 'postgresql://localhost/xlocale'
  const url = allocateE2eDatabaseUrl()
  const file = process.env.E2E_DATABASE_URL_FILE
  assert.ok(file?.endsWith(`database-url-${process.pid}`))
  clearTrackedDatabaseUrl()
  assert.equal(fs.existsSync(file!), false)
  assert.equal(readTrackedDatabaseUrl(), null)
  assert.ok(url.startsWith('postgresql://localhost/xlocale_e2e_'))
})

test('a refused setup does not delete a user-supplied tracking file', () => {
  const file = useFile()
  fs.writeFileSync(file, 'postgresql://localhost/xlocale_e2e_keep')
  clearTrackedDatabaseUrl()
  assert.equal(fs.readFileSync(file, 'utf8'), 'postgresql://localhost/xlocale_e2e_keep')
})

test('teardown refuses a tracked name that was not created in this process', () => {
  const app = 'postgresql://localhost/xlocale'
  const createdName = 'xlocale_e2e_run_1700000000_abc'
  const created = `postgresql://localhost/${createdName}`
  assert.throws(() => assertTeardownDatabase(created, app, undefined), /does not match/)
  assert.throws(
    () => assertTeardownDatabase(created, app, 'postgresql://localhost/xlocale_e2e_other_1700000000_def'),
    /does not match/,
  )
  assert.throws(
    () => assertTeardownDatabase('postgresql://localhost/xlocale', app, 'postgresql://localhost/xlocale'),
    /Refusing tracked database/,
  )
  assert.throws(
    () => assertTeardownDatabase('postgresql://localhost/xlocale_e2e_app', 'postgresql://localhost/xlocale_e2e_app', 'postgresql://localhost/xlocale_e2e_app'),
    /application database/,
  )
  assert.throws(
    () => assertTeardownDatabase('postgresql://other.example/xlocale_e2e_run_1700000000_abc', app, created),
    /does not match/,
  )
  assert.throws(
    () => assertTeardownDatabase('postgresql://localhost:5433/xlocale_e2e_run_1700000000_abc', app, created),
    /does not match/,
  )
  assert.equal(assertTeardownDatabase(created, app, created), createdName)
  assert.equal(
    assertTeardownDatabase('postgresql://localhost:5432/xlocale_e2e_run_1700000000_abc', app, created),
    createdName,
  )
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
  assert.match(setup, /CREATED_DATABASE_ENV/)
  assert.match(setup, /seed-demo --force/)
  assert.doesNotMatch(setup, /allow-production/)
  assert.doesNotMatch(setup, /postgres_admin create /)
  assert.match(setup, /clearTrackedDatabaseUrl/)
  assert.match(teardown, /readTrackedDatabaseUrl/)
  assert.match(teardown, /assertTeardownDatabase/)
  assert.doesNotMatch(teardown, /e2eDatabaseUrl\(/)
  assert.doesNotMatch(teardown, /allocateE2eDatabaseUrl\(/)
})
