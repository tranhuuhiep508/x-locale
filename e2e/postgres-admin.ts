import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const backendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../backend')

/** Pass URLs literally so database passwords never undergo shell expansion. */
export function runPostgresAdmin(
  action: 'sweep' | 'create-new' | 'drop',
  databaseUrl: string,
  env: NodeJS.ProcessEnv,
): void {
  execFileSync('uv', ['run', 'python', '-m', 'app.postgres_admin', action, databaseUrl], {
    cwd: backendDirectory,
    env,
    stdio: 'inherit',
  })
}
