import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'

// Roles of today's app (backend core/database.py UserRole). Phase 04 replaces them with the six target roles.
export type Role =
  | 'super_admin'
  | 'admin'
  | 'org_admin'
  | 'community_lead'
  | 'automation_lead'
  | 'automation_user'
  | 'user'
  | 'viewer'

type Sessions = Record<Role, { username: string; token: string }>

let sessions: Sessions | undefined

function readSessions(): Sessions {
  sessions ??= JSON.parse(readFileSync(process.env.E2E_SESSIONS_FILE!, 'utf8')) as Sessions
  return sessions
}

/** Username and password of the seeded user for a role. */
export function credentials(role: Role) {
  return { username: readSessions()[role].username, password: process.env.E2E_PASSWORD! }
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
