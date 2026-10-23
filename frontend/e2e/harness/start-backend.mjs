// Starts the real backend for the UI tests: a fresh SQLite database, one seeded user per role, a free port.
// Playwright runs this as a webServer (see playwright.config.ts) and stops it when the run ends.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const backendDir = resolve(here, '../../../backend')
const sessionsFile = process.env.E2E_SESSIONS_FILE
const port = process.env.E2E_BACKEND_PORT
if (!sessionsFile || !port) {
  console.error('E2E_SESSIONS_FILE and E2E_BACKEND_PORT are set by playwright.config.ts')
  process.exit(1)
}

const venvPython = join(backendDir, '.venv', 'bin', 'python')
const python = process.env.ATM_PYTHON || (existsSync(venvPython) ? venvPython : 'python3')

const workDir = mkdtempSync(join(tmpdir(), 'atm-e2e-'))
const env = {
  ...process.env,
  ATM_DATABASE_PATH: join(workDir, 'e2e.db'),
  SECRET_KEY: 'e2e-secret-key',
  HOST: '127.0.0.1',
  PORT: port,
  PYTHONUNBUFFERED: '1',
}

mkdirSync(dirname(sessionsFile), { recursive: true })
execFileSync(python, ['-m', 'tools.e2e_seed', sessionsFile], { cwd: backendDir, env, stdio: 'inherit' })

const server = spawn(python, ['main.py'], { cwd: backendDir, env, stdio: 'inherit' })

const stop = () => {
  server.kill('SIGTERM')
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
server.on('exit', code => {
  rmSync(workDir, { recursive: true, force: true })
  process.exit(code ?? 0)
})
