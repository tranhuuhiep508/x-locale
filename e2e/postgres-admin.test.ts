import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

import { runPostgresAdmin } from './postgres-admin.ts'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-admin-'))
after(() => fs.rmSync(dir, { recursive: true, force: true }))

test('all admin actions pass passwords with shell expressions literally', () => {
  const executable = path.join(dir, 'uv')
  const recorded = path.join(dir, 'arguments.json')
  fs.writeFileSync(
    executable,
    `#!${process.execPath}\n` +
      "require('node:fs').writeFileSync(process.env.REVIEW_ARGS_FILE, JSON.stringify(process.argv.slice(2)))\n",
    { mode: 0o755 },
  )
  const databaseUrl =
    'postgresql+psycopg://role:pass$XLOCALE_REVIEW_TOKEN$(printf injected)@localhost/xlocale_e2e_run'
  const env = {
    ...process.env,
    PATH: `${dir}${path.delimiter}${process.env.PATH ?? ''}`,
    REVIEW_ARGS_FILE: recorded,
    XLOCALE_REVIEW_TOKEN: 'expanded',
  }
  for (const action of ['sweep', 'create-new', 'drop'] as const) {
    runPostgresAdmin(action, databaseUrl, env)
    assert.deepEqual(JSON.parse(fs.readFileSync(recorded, 'utf8')), [
      'run',
      'python',
      '-m',
      'app.postgres_admin',
      action,
      databaseUrl,
    ])
  }
})
