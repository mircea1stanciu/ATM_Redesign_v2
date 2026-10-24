// Starts the real backend for the UI tests: a fresh SQLite database, one seeded user per role, a sample project
// whose repository lives in the fake GitHub (fake-services.mjs), and a free port.
// Playwright runs this as a webServer (see playwright.config.ts) and stops it when the run ends.
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const backendDir = resolve(here, '../../../backend')
const sessionsFile = process.env.E2E_SESSIONS_FILE
const port = process.env.E2E_BACKEND_PORT
const fakeRoot = process.env.E2E_FAKE_ROOT
const fakePort = process.env.E2E_FAKE_PORT
if (!sessionsFile || !port || !fakeRoot || !fakePort) {
  console.error('E2E_SESSIONS_FILE, E2E_BACKEND_PORT, E2E_FAKE_ROOT and E2E_FAKE_PORT are set by playwright.config.ts')
  process.exit(1)
}

const venvPython = join(backendDir, '.venv', 'bin', 'python')
const python = process.env.ATM_PYTHON || (existsSync(venvPython) ? venvPython : 'python3')

const workDir = mkdtempSync(join(tmpdir(), 'atm-e2e-'))

// Sample repository: a bare "GitHub" repository served by the fake services, and the user's checkout of it.
const git = (args, cwd) => execFileSync('git', ['-c', 'user.name=ATM E2E', '-c', 'user.email=e2e@atm.test', ...args],
  { cwd, stdio: 'pipe' })
const repoUrl = `http://127.0.0.1:${fakePort}/e2e/sample.git`
const bareRepo = join(fakeRoot, 'e2e', 'sample.git')
rmSync(fakeRoot, { recursive: true, force: true })
mkdirSync(bareRepo, { recursive: true })
git(['init', '--bare', '--initial-branch=main', bareRepo])
git(['config', 'http.receivepack', 'true'], bareRepo)
const seedTree = join(workDir, 'seed-tree')
mkdirSync(join(seedTree, 'scripts'), { recursive: true })
writeFileSync(join(seedTree, 'README.md'), '# E2E sample\n')
writeFileSync(join(seedTree, 'scripts', 'hello.sh'), '#!/usr/bin/env bash\necho "hello from ATM e2e"\n')
chmodSync(join(seedTree, 'scripts', 'hello.sh'), 0o755)
// A test file that shares words with the Jira story E2E-1, so "Start work" has something to suggest.
mkdirSync(join(seedTree, 'tests', 'ui'), { recursive: true })
writeFileSync(join(seedTree, 'tests', 'ui', 'login_error.spec.ts'), "// Login error message\n")
// A pytest test without an assertion: the workspace hint asks for one, and "Run changed tests" runs it.
writeFileSync(join(seedTree, 'tests', 'test_login_error.py'), "def test_login_error_message():\n    message = 'Wrong email or password'\n")
writeFileSync(join(seedTree, 'pytest.ini'), '[pytest]\n')
writeFileSync(join(seedTree, '.gitignore'), '.venv/\n.pytest_cache/\n__pycache__/\n')
// A k6 script, so a performance suite can be created and run (k6 itself is the stand-in below).
mkdirSync(join(seedTree, 'perf'), { recursive: true })
writeFileSync(join(seedTree, 'perf', 'load.js'), "import http from 'k6/http'\nexport default function () { http.get(__ENV.BASE_URL) }\n")
git(['init', '--initial-branch=main'], seedTree)
git(['add', '.'], seedTree)
git(['commit', '-m', 'Initial sample'], seedTree)
git(['push', bareRepo, 'main'], seedTree)
const checkout = join(workDir, 'checkout')
git(['clone', bareRepo, checkout])
git(['remote', 'set-url', 'origin', repoUrl], checkout)
// The senior's own checkout: the Work tests create branches there without touching the shared one.
const seniorCheckout = join(workDir, 'checkout-senior')
git(['clone', bareRepo, seniorCheckout])
git(['remote', 'set-url', 'origin', repoUrl], seniorCheckout)
// The trainee's own checkout, for the workspace tests. Its .venv runs this Python, which has pytest.
const traineeCheckout = join(workDir, 'checkout-trainee')
git(['clone', bareRepo, traineeCheckout])
git(['remote', 'set-url', 'origin', repoUrl], traineeCheckout)
const realPython = execFileSync(python, ['-c', 'import sys; print(sys.executable)']).toString().trim()
mkdirSync(join(traineeCheckout, '.venv', 'bin'), { recursive: true })
writeFileSync(join(traineeCheckout, '.venv', 'bin', 'python'), `#!/bin/sh\nexec "${realPython}" "$@"\n`)
chmodSync(join(traineeCheckout, '.venv', 'bin', 'python'), 0o755)

// A stand-in for k6 on PATH: it writes a realistic --summary-export file and exits 0, so performance runs work
// without installing k6. It records BASE_URL in the summary so tests can check the environment reached the runner.
const binDir = join(workDir, 'bin')
mkdirSync(binDir, { recursive: true })
writeFileSync(join(binDir, 'k6'), `#!/usr/bin/env node
const args = process.argv.slice(2)
const out = args[args.indexOf('--summary-export') + 1]
const summary = {
  root_group: { name: '', checks: { 'status is 200': { passes: 100, fails: 0 } }, groups: [] },
  metrics: {
    http_req_duration: { avg: 85.4, 'p(90)': 120.2, 'p(95)': 142.7, max: 310.5 },
    http_reqs: { count: 100, rate: 19.8 },
    http_req_failed: { value: 0 },
    vus_max: { value: 5, max: 5 },
    iterations: { count: 100 },
  },
  base_url: process.env.BASE_URL || null,
}
require('fs').writeFileSync(out, JSON.stringify(summary))
console.log('     ✓ status is 200')
console.log('     http_req_duration..............: avg=85.4ms p(95)=142.7ms')
`)
chmodSync(join(binDir, 'k6'), 0o755)

const env = {
  ...process.env,
  PATH: `${binDir}:${process.env.PATH}`,
  // Suite schedules are checked every 2 s, so "schedule a suite and see it start" does not wait half a minute.
  ATM_SCHEDULER_INTERVAL_SECONDS: '2',
  ATM_DATABASE_PATH: join(workDir, 'e2e.db'),
  // AI conversations and other artifacts: per run, so a run never sees an earlier run's files.
  ARTIFACTS_DIR: join(workDir, 'artifacts'),
  SECRET_KEY: 'e2e-secret-key',
  HOST: '127.0.0.1',
  PORT: port,
  PYTHONUNBUFFERED: '1',
  E2E_REPO_URL: repoUrl,
  E2E_CHECKOUT_DIR: checkout,
  E2E_SENIOR_CHECKOUT_DIR: seniorCheckout,
  E2E_TRAINEE_CHECKOUT_DIR: traineeCheckout,
  // The "GitHub Copilot" AI provider answers from the fake services.
  ATM_GITHUB_MODELS_BASE_URL: `http://127.0.0.1:${fakePort}/models`,
  E2E_FAKE_URL: `http://127.0.0.1:${fakePort}`,
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
  rmSync(fakeRoot, { recursive: true, force: true })
  process.exit(code ?? 0)
})
