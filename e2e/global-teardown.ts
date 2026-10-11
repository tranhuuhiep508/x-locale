import {
  CREATED_DATABASE_ENV,
  assertTeardownDatabase,
  clearTrackedDatabaseUrl,
  readTrackedDatabaseUrl,
} from './database-url'
import { runPostgresAdmin } from './postgres-admin'

export default async function globalTeardown() {
  const databaseUrl = readTrackedDatabaseUrl()
  if (!databaseUrl) return
  assertTeardownDatabase(databaseUrl, process.env.DATABASE_URL, process.env[CREATED_DATABASE_ENV])
  try {
    runPostgresAdmin('drop', databaseUrl, {
      ...process.env,
      DATABASE_URL: databaseUrl,
    })
  } finally {
    clearTrackedDatabaseUrl()
  }
}
