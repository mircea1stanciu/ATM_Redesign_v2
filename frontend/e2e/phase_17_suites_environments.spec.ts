import { expect, test, type APIRequestContext } from '@playwright/test'
import { authHeaders, login } from './helpers'

// Phase 17 (from the decisions review): secret environment variables reach the run but never the page; "Changed
// tests" runs with the chosen environment; suites are archived and restored, and only leads delete them permanently.

test.describe.configure({ mode: 'serial', timeout: 120_000 })

test.beforeEach(({ page }) => {
  page.on('pageerror', error => {
    throw new Error(`Uncaught error in the page: ${error.message}`)
  })
})

const SUFFIX = Date.now().toString(36)
const ENVIRONMENT = `P17 secrets ${SUFFIX}`
const SECRET = `p17-secret-${SUFFIX}`
const SUITE = `P17 archive me ${SUFFIX}`
const FILE = 'tests/test_login_error.py'

async function projectId(request: APIRequestContext): Promise<string> {
  const projects = await (await request.get('/api/projects/', { headers: authHeaders('automation_senior') })).json()
  return projects.find((p: { name: string }) => p.name === 'E2E Sample Project').id
}

test('a senior adds a secret variable; the page never shows its value', async ({ page, request }) => {
  await login(page, 'automation_senior')
  await page.goto('/tests/environments')
  await page.getByRole('button', { name: 'New environment' }).click()
  const dialog = page.getByRole('dialog', { name: 'New environment' })
  await dialog.getByLabel('Name', { exact: true }).fill(ENVIRONMENT)
  await dialog.getByRole('button', { name: 'Add secret' }).click()
  await dialog.getByLabel('Secret 1 name').fill('P17_TOKEN')
  await dialog.getByLabel('Secret 1 value').fill(SECRET)
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()

  const row = page.getByRole('list', { name: 'Environments' }).getByRole('listitem').filter({ hasText: ENVIRONMENT })
  await expect(row).toContainText('P17_TOKEN=••••')
  await expect(page.getByText(SECRET)).toHaveCount(0)
  const listed = await request.get(`/api/projects/${await projectId(request)}/environments`, { headers: authHeaders('automation_senior') })
  expect(await listed.text()).not.toContain(SECRET)

  await row.getByRole('button', { name: `Edit ${ENVIRONMENT}` }).click()
  const edit = page.getByRole('dialog', { name: `Edit ${ENVIRONMENT}` })
  await expect(edit.getByLabel('New value for P17_TOKEN')).toHaveValue('') // the saved value is not sent back
  await edit.getByRole('button', { name: 'Cancel' }).click()
})

test('changed tests run with the chosen environment, and the secret reaches the test', async ({ page, request }) => {
  const id = await projectId(request)
  // In the tester's own checkout: the sample test now passes only when the secret arrives.
  const written = await request.put(`/api/projects/${id}/local/file`, {
    headers: authHeaders('secrets_tester'),
    data: { path: FILE, content: `import os\n\ndef test_login_error_message():\n    assert os.environ['P17_TOKEN'] == '${SECRET}'\n` },
  })
  expect(written.ok()).toBeTruthy()

  await login(page, 'secrets_tester')
  await page.goto('/tests/runs')
  await page.getByRole('button', { name: 'Run tests' }).click()
  const dialog = page.getByRole('dialog', { name: /Run/ })
  await dialog.getByRole('tab', { name: 'Changed tests' }).click()
  await dialog.getByLabel('Environment').selectOption({ label: ENVIRONMENT })
  const target = dialog.locator('div').filter({ hasText: new RegExp(`^pytest: ${FILE}`) }).last()
  await target.getByRole('button', { name: 'Run' }).click()

  const environments = await (await request.get(`/api/projects/${id}/environments`, { headers: authHeaders('secrets_tester') })).json()
  const environmentId = environments.find((e: { name: string }) => e.name === ENVIRONMENT).id
  const mine = async () => (await (await request.get(`/api/runs/projects/${id}`, { headers: authHeaders('secrets_tester') })).json())
    .filter((r: { triggered_by: string }) => r.triggered_by === 'secrets_tester@e2e.test')
    .sort((a: { created_at: string }, b: { created_at: string }) => b.created_at.localeCompare(a.created_at))[0]
  await expect.poll(async () => (await mine())?.status, { timeout: 90_000 }).toBe('passed')
  expect((await mine()).environment_id).toBe(environmentId)
})

test('suites are archived and restored; only a lead deletes one permanently', async ({ page, request }) => {
  const id = await projectId(request)
  expect((await request.post(`/api/suites/projects/${id}/suites`, { headers: authHeaders('automation_senior'), data: { name: SUITE } })).ok()).toBeTruthy()

  await login(page, 'automation_senior')
  await page.goto('/tests/suites')
  await page.getByRole('button', { name: `Archive ${SUITE}` }).click()
  await page.getByRole('button', { name: 'Archive suite' }).click()
  await expect(page.getByRole('list', { name: 'Suites' }).getByText(SUITE)).toHaveCount(0)
  await page.getByRole('tab', { name: 'Archived' }).click()
  const archived = page.getByRole('list', { name: 'Archived suites' }).getByRole('listitem').filter({ hasText: SUITE })
  await expect(archived).toBeVisible()
  await expect(archived.getByRole('button', { name: `Delete ${SUITE} permanently` })).toHaveCount(0) // seniors archive only
  await archived.getByRole('button', { name: `Restore ${SUITE}` }).click()
  await expect(archived).toHaveCount(0)
  await page.getByRole('tab', { name: 'Active' }).click()
  await page.getByRole('button', { name: `Archive ${SUITE}` }).click()
  await page.getByRole('button', { name: 'Archive suite' }).click()

  await login(page, 'automation_lead')
  await page.goto('/tests/suites?show=archived')
  const row = page.getByRole('list', { name: 'Archived suites' }).getByRole('listitem').filter({ hasText: SUITE })
  await row.getByRole('button', { name: `Delete ${SUITE} permanently` }).click()
  await page.getByRole('button', { name: 'Delete permanently' }).click()
  await expect(row).toHaveCount(0)
})
