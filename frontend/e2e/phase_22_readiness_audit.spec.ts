import { expect, test } from '@playwright/test'
import { authHeaders, fakeServicesUrl, login } from './helpers'

// Phase 22 (from the decisions review): the readiness evidence shows the pull requests GitHub says were merged after an
// approval, and how the person used the AI; the audit log records a failed sign-in and a deletion.

test.describe.configure({ mode: 'serial', timeout: 120_000 })

test.beforeEach(({ page }) => {
  page.on('pageerror', error => {
    throw new Error(`Uncaught error in the page: ${error.message}`)
  })
})

const SUFFIX = Date.now().toString(36)
const GHOST = `p22-ghost-${SUFFIX}`
const SERVICE = `p22-cart-${SUFFIX}`

test('the evidence shows pull requests merged after review and the AI use', async ({ page, request }) => {
  // On GitHub, as e2e-mentee: one pull request approved and merged, one approved and still open.
  for (const [name, merged] of [['merged', true], ['open', false]] as const) {
    expect((await request.post(`${fakeServicesUrl()}/__e2e/pull-request`, {
      data: {
        branch: `mentee/${name}-${SUFFIX}`, path: `tests/test_${name}_${SUFFIX}.py`, title: `Mentee ${name} ${SUFFIX}`,
        content: 'def test_it():\n    assert True\n', author: 'e2e-mentee', merged,
        reviews: [{ login: 'e2e-senior', state: 'APPROVED' }],
      },
    })).ok()).toBeTruthy()
  }
  // The mentee asks the AI tutor once (fake GitHub Models provider).
  const mentee = authHeaders('mentee')
  expect((await request.put('/api/ai/settings', { headers: mentee, data: { provider: 'github', api_key: 'e2e-ai-key', model: 'openai/gpt-4.1' } })).ok()).toBeTruthy()
  expect((await request.post('/api/learning/tutor', { headers: mentee, data: { lesson: 'Why Bruno', question: 'Why use Bruno?' } })).ok()).toBeTruthy()

  const { people } = await (await request.get('/api/learning/mentor', { headers: authHeaders('automation_lead') })).json()
  const menteeId = people.find((p: { name: string }) => p.name === 'E2E Mentee').id
  await login(page, 'automation_lead')
  await page.goto(`/learning/readiness/${menteeId}`)
  const evidence = page.locator('dl[aria-label="Evidence"]')
  const merged = evidence.locator('div').filter({ has: page.getByText('Merged after review', { exact: true }) })
  await expect(merged.locator('dd').first()).toHaveText('1')
  await expect(merged).toContainText('1 approved, not merged yet')
  const ai = evidence.locator('div').filter({ has: page.getByText('AI use', { exact: true }) })
  await expect(ai.locator('dd').first()).toHaveText('1')
  await expect(ai).toContainText('1 tutor questions')
})

test('a failed sign-in and a deletion appear in Admin › Audit', async ({ page, request }) => {
  await page.goto('/login')
  await page.getByLabel('Username or email').fill(GHOST)
  await page.getByLabel('Password').fill('not-a-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Invalid credentials')).toBeVisible()

  expect((await request.post('/api/deployments/services', { headers: authHeaders('automation_lead'), data: { name: SERVICE } })).ok()).toBeTruthy()
  await login(page, 'super_admin')
  await page.goto('/deployments/services')
  await page.getByRole('button', { name: `Delete ${SERVICE}` }).click()
  const confirm = page.getByRole('dialog', { name: `Delete ${SERVICE}?` })
  await confirm.getByRole('button', { name: 'Delete' }).click()
  await expect(confirm).toBeHidden()

  await page.goto('/admin/audit')
  const log = page.getByRole('table', { name: 'Audit log' })
  await page.getByLabel('What').selectOption({ label: 'Failed sign-in' })
  await expect(log).toContainText(`Failed sign-in as ${GHOST}: Wrong user name or password`)
  await page.getByLabel('What').selectOption({ label: 'Service deleted' })
  await expect(log).toContainText(`E2E Super Admin deleted the service ${SERVICE}`)
})
