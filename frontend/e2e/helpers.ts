import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'

// The six roles (docs/redesign/04-roles-and-permissions.md); backend/tools/e2e_seed.py seeds one user per role.
export type Role =
  | 'super_admin'
  | 'automation_lead'
  | 'automation_senior'
  | 'automation_user'
  | 'automation_trainee'
  | 'viewer'

type Sessions = Record<Role, { username: string; token: string }>

let sessions: Sessions | undefined

function readSessions(): Sessions {
  sessions ??= JSON.parse(readFileSync(process.env.E2E_SESSIONS_FILE!, 'utf8')) as Sessions
  return sessions
}

/** Base URL of the GitHub, Jira and Confluence stand-ins (e2e/harness/fake-services.mjs). */
export function fakeServicesUrl() {
  return `http://127.0.0.1:${process.env.E2E_FAKE_PORT}`
}

/** Username and password of the seeded user for a role. */
export function credentials(role: Role) {
  return { username: readSessions()[role].username, password: process.env.E2E_PASSWORD! }
}

/** Authorization header for calling the API (through the Vite proxy) as the seeded user of a role. */
export function authHeaders(role: Role) {
  return { Authorization: `Bearer ${readSessions()[role].token}` }
}

/**
 * Opens the app as the seeded user of a role, using the token minted by the seed script.
 * The login endpoint allows 5 attempts per minute, so only the login spec signs in through the form.
 */
export async function login(page: Page, role: Role) {
  const { token } = readSessions()[role]
  await page.goto('/login')
  await page.evaluate(value => {
    localStorage.setItem('tm_access_token', value)
    localStorage.setItem('tm_last_activity_at', String(Date.now()))
  }, token)
  await page.goto('/')
}
