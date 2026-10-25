import { expect, test } from '@playwright/test'
import { authHeaders, login } from './helpers'

// Phase 02 removed features that do not serve the redesign goals. The remaining screens are covered by phase 01.

test.beforeEach(({ page }) => {
  page.on('pageerror', error => {
    throw new Error(`Uncaught error in the page: ${error.message}`)
  })
})

test('Community, removed in phase 13, is back as its own page (phase 21); viewers do not see it', async ({ page }) => {
  await login(page, 'super_admin')
  const nav = page.getByRole('navigation', { name: 'Main' })
  await nav.getByRole('link', { name: 'Community', exact: true }).click()
  await expect(page).toHaveURL(/\/community$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Community' })).toBeVisible()

  await login(page, 'viewer')
  await expect(nav.getByRole('link', { name: 'Community', exact: true })).toHaveCount(0)
})

test('Settings no longer offers the mock privacy, data and billing sections', async ({ page }) => {
  await login(page, 'super_admin')
  await page.goto('/settings')
  await expect(page.getByRole('link', { name: /^My Profile/ })).toBeVisible()
  for (const removed of [/^Privacy/, /^Data & Integrations/, /^Billing/]) {
    await expect(page.getByRole('link', { name: removed })).toHaveCount(0)
  }

  for (const section of ['community-privacy', 'data-integrations', 'subscription-billing']) {
    await page.goto(`/settings/${section}`)
    await expect(page).toHaveURL(/\/settings\/profile$/)
  }
})

test('removed backend features answer 404, kept ones still work', async ({ request }) => {
  const headers = authHeaders('super_admin')
  const removed = [
    '/api/office/islands',
    '/api/organizations',
    '/api/features',
    '/api/subscription-plans',
    '/api/subscription',
    '/api/billing/invoices',
    '/api/data/exports',
    '/api/integrations',
    '/api/settings/privacy',
    '/api/v1/messaging/conversations',
    '/api/ai-models',
    '/api/communities/qa/examples',
  ]
  for (const path of removed) {
    const response = await request.get(path, { headers })
    expect(response.status(), path).toBe(404)
  }

  for (const path of ['/api/auth/me', '/api/projects/', '/api/settings/preferences/ai', '/api/health']) {
    const response = await request.get(path, { headers })
    expect(response.status(), path).toBe(200)
  }
})

test('a fresh database has no accounts with built-in passwords', async ({ request }) => {
  const headers = authHeaders('super_admin')
  const users: Array<{ username: string; email: string }> = await (await request.get('/api/users', { headers })).json()

  const usernames = users.map(user => user.username)
  expect(usernames).toContain('e2e_super_admin')
  // Before phase 02 every start created admin/admin123 and seven demo users with demo123.
  expect(usernames).not.toContain('admin')
  expect(users.filter(user => user.email.endsWith('@demo.com'))).toEqual([])
})
