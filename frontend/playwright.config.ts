import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// Ports are picked once by the main Playwright process; workers reload this file and inherit them via env.
function freePort(): string {
  const script =
    "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"
  return execFileSync(process.execPath, ['-e', script]).toString()
}

process.env.E2E_BACKEND_PORT ||= freePort()
process.env.E2E_FRONTEND_PORT ||= freePort()
process.env.E2E_FAKE_PORT ||= freePort()
process.env.E2E_FAKE_ROOT ||= path.join(os.tmpdir(), `atm-e2e-fake-${process.env.E2E_FAKE_PORT}`)
process.env.E2E_SESSIONS_FILE ||= path.resolve('e2e/.auth/sessions.json')
process.env.E2E_PASSWORD ||= 'e2e-Password-1'

const backendUrl = `http://127.0.0.1:${process.env.E2E_BACKEND_PORT}`
const frontendUrl = `http://127.0.0.1:${process.env.E2E_FRONTEND_PORT}`
const fakeUrl = `http://127.0.0.1:${process.env.E2E_FAKE_PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: frontendUrl,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // GitHub, Jira and Confluence stand-ins (see e2e/harness/fake-services.mjs).
      command: 'node e2e/harness/fake-services.mjs',
      url: `${fakeUrl}/__e2e/health`,
      timeout: 30_000,
    },
    {
      command: 'node e2e/harness/start-backend.mjs',
      url: `${backendUrl}/openapi.json`,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${process.env.E2E_FRONTEND_PORT} --strictPort`,
      url: frontendUrl,
      timeout: 120_000,
      env: { ATM_API_TARGET: backendUrl },
    },
  ],
})
