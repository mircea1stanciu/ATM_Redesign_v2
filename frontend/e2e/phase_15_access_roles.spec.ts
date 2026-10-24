import { expect, test } from '@playwright/test'
import { login } from './helpers'

// Phase 15 (from the decisions review): a self-registered Viewer without projects is told how to get access and sees
// only Home, Tests, Reports, Reviews and Deploys; Admin is for Leads and Super Admins, and people lists follow the
// hierarchy; a Lead takes on someone without a lead.

test.describe.configure({ mode: 'serial', timeout: 60_000 })

test.beforeEach(({ page }) => {
  page.on('pageerror', error => {
    throw new Error(`Uncaught error in the page: ${error.message}`)
  })
})

const SUFFIX = Date.now().toString(36)
const NEWCOMER = `E2E Newcomer ${SUFFIX}`

test('a self-registered viewer sees the access banner and five areas', async ({ page, request }) => {
  const registered = await request.post('/api/auth/register', {
    data: { username: `newcomer-${SUFFIX}`, email: `newcomer-${SUFFIX}@example.com`, password: 'Newcomer-Pass-1', full_name: NEWCOMER },
  })
  expect(registered.ok()).toBeTruthy()
  const token = (await registered.json()).access_token
  await page.goto('/login')
  await page.evaluate(value => {
    localStorage.setItem('tm_access_token', value)
    localStorage.setItem('tm_last_activity_at', String(Date.now()))
  }, token)
  await page.goto('/')
  await expect(page.getByRole('status').filter({ hasText: "You don't have access to any project yet." })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link'))
    .toHaveText(['Home', 'Tests', 'Reports', 'Reviews', 'Deploys', 'Settings'])
  await page.goto('/learning')
  await expect(page).toHaveURL(/\/$/)
})

test('people with a project see no banner; seniors have no Admin', async ({ page }) => {
  await login(page, 'automation_senior')
  await expect(page.getByRole('heading', { name: 'Waiting for my review' })).toBeVisible()
  await expect(page.getByText("You don't have access to any project yet.")).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0)
  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\/$/)
})

test('a lead sees only the people below them and takes on the newcomer', async ({ page }) => {
  await login(page, 'automation_lead')
  await page.goto('/admin/users')
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible()
  await expect(page.getByText('e2e_automation_trainee@e2e.test')).toBeVisible()
  await expect(page.getByText('e2e_super_admin@e2e.test')).toHaveCount(0) // nobody above a lead
  await page.getByRole('button', { name: `Assign ${NEWCOMER} to me` }).click()
  await expect(page.getByRole('button', { name: `Assign ${NEWCOMER} to me` })).toHaveCount(0)
  await expect(page.getByRole('button', { name: `Edit ${NEWCOMER}` })).toBeVisible() // now one of the lead's people
})
