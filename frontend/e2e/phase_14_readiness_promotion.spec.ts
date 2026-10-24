import { expect, test } from '@playwright/test'
import { login } from './helpers'

// Phase 14: a trainee asks for a readiness review, the lead looks at the evidence and promotes them to User with a
// note; at the next page load the new role's navigation and permissions apply, the user is notified, and the
// decision is in the audit log. The candidate is seeded for this test (backend/tools/e2e_seed.py).

test.describe.configure({ mode: 'serial', timeout: 90_000 })

test.beforeEach(({ page }) => {
  page.on('pageerror', error => {
    throw new Error(`Uncaught error in the page: ${error.message}`)
  })
})

const NAME = 'E2E Promotion Candidate'
const NOTE = 'Steady practice and clear tests: ready for the User role.'

test('the trainee asks for a readiness review', async ({ page }) => {
  await login(page, 'promotion_candidate')
  await expect(page.getByRole('heading', { name: 'My learning path' })).toBeVisible() // a trainee's Home
  await page.goto('/tests/suites')
  await expect(page.getByRole('heading', { name: 'Tests', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New suite' })).toHaveCount(0) // trainees do not manage suites

  await page.goto('/learning/readiness')
  await expect(page).toHaveURL(/\/learning\/readiness\/\d+$/)
  await expect(page.getByRole('heading', { name: new RegExp(NAME) })).toBeVisible()
  await page.getByLabel('Readiness request note').fill('I finished the Bruno path and two practice tasks.')
  await page.getByRole('button', { name: 'Request readiness review' }).click()
  await expect(page.getByText(/Readiness review requested/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Request readiness review' })).toHaveCount(0)
})

test('the lead looks at the evidence and promotes the trainee with a note', async ({ page }) => {
  await login(page, 'automation_lead')
  await page.getByRole('list', { name: 'Readiness requests' }).getByRole('link', { name: NAME }).click() // Home
  await expect(page).toHaveURL(/\/learning\/readiness\/\d+$/)
  await expect(page.getByText('I finished the Bruno path and two practice tasks.')).toBeVisible()
  const evidence = page.getByRole('definition').filter({ hasText: /^\d+$/ })
  await expect(evidence.first()).toBeVisible()
  await expect(page.getByLabel('New role')).toHaveValue('automation_user')
  await expect(page.getByLabel('New role').getByRole('option')).toHaveText(['Automation User', 'Automation Senior'])
  await page.getByLabel('Decision note').fill(NOTE)
  await page.getByRole('button', { name: 'Promote to Automation User' }).click()
  const history = page.getByRole('list', { name: 'Readiness decisions' })
  await expect(history).toContainText('Promoted to Automation User')
  await expect(history).toContainText(NOTE)
  await expect(page.getByRole('heading', { name: new RegExp(`${NAME}.*Automation User`) })).toBeVisible()
})

test('at the next page load the user has the new role, and is told why', async ({ page }) => {
  await login(page, 'promotion_candidate') // the same token: the role is read from the server on every load
  await expect(page.getByRole('heading', { name: 'My work items' })).toBeVisible() // a user's Home
  await expect(page.getByRole('heading', { name: 'My learning path' })).toHaveCount(0)
  await page.getByRole('button', { name: /^Notifications/ }).click()
  await expect(page.getByRole('list', { name: 'Notifications' })).toContainText('You are now Automation User')
  await page.keyboard.press('Escape')
  await page.goto('/tests/suites')
  await expect(page.getByRole('button', { name: 'New suite' })).toBeVisible() // users manage suites
})

test('the decision is in the audit log', async ({ page }) => {
  await login(page, 'automation_lead')
  await page.goto('/admin/audit')
  await page.getByLabel('What').selectOption({ label: 'Promotion' })
  const row = page.getByRole('table', { name: 'Audit log' }).getByRole('row').filter({ hasText: NAME })
  await expect(row).toContainText(`promoted ${NAME} from Automation Trainee to Automation User`)
  await expect(row).toContainText(NOTE)
})
