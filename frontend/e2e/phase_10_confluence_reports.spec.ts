import { expect, test, type APIRequestContext } from '@playwright/test'
import { authHeaders, fakeServicesUrl, login } from './helpers'

// Phase 10: publish a run's report to Confluence (the fake one in e2e/harness/fake-services.mjs): one page per
// suite under the project's parent page (900, seeded), updated on each publication, with the report attached.

test.describe.configure({ mode: 'serial', timeout: 180_000 })

test.beforeEach(({ page }) => {
  page.on('pageerror', error => {
    throw new Error(`Uncaught error in the page: ${error.message}`)
  })
})

const senior = authHeaders('automation_senior')
const TITLE = 'E2E Sample Project · Login regression · Test report'
let runId = ''

type Write = { action: string; title?: string; ancestors?: Array<{ id: string }>; space?: { key: string }; body?: string; version?: number; filename?: string; bytes?: number; token?: string }

async function confluenceWrites(request: APIRequestContext): Promise<Write[]> {
  return (await (await request.get(`${fakeServicesUrl()}/__e2e/requests`)).json()).confluenceWrites
}

test('a run of the suite has an Allure report', async ({ request }) => {
  const projects = await (await request.get('/api/projects/', { headers: senior })).json()
  const projectId = projects.find((p: { name: string }) => p.name === 'E2E Sample Project').id
  const detection = await (await request.get(`/api/projects/${projectId}/local/frameworks?refresh=true`, { headers: senior })).json()
  const target = detection.frameworks.flatMap((f: { targets: Array<{ id: string; label: string }> }) => f.targets)
    .find((t: { label: string }) => t.label === 'tests/test_login_error.py')
  const suite = await (await request.post(`/api/suites/projects/${projectId}/suites`, {
    headers: senior, data: { name: 'Login regression', test_type: 'regression', target: target.id },
  })).json()
  runId = (await (await request.post(`/api/suites/${suite.id}/runs`, { headers: senior, data: {} })).json()).run.id
  await expect.poll(async () => (await request.post(`/api/runs/${runId}/report-link`, { headers: senior })).status(),
    { timeout: 120_000, intervals: [1000] }).toBe(200)
})

test('publish to Confluence: the page, its content and the attached report', async ({ page, request }) => {
  await login(page, 'automation_senior')
  await page.goto(`/reports/runs/${runId}`)
  await page.getByRole('button', { name: 'Publish to Confluence' }).click()
  await expect(page.getByText('Published to Confluence (version 1)')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Confluence publications' })).toContainText('Published · v1')

  const writes = await confluenceWrites(request)
  const created = writes.find(w => w.action === 'create' && w.title === TITLE)!
  expect(created.space).toEqual({ key: 'E2E' })
  expect(created.ancestors).toEqual([{ id: '900' }])
  expect(created.body).toContain('100.0 %')
  expect(created.body).toContain('ac:name="status"')
  expect(created.body).toContain(`/reports/runs/${runId}`)
  const attachment = writes.find(w => w.action === 'attach' && w.filename === `allure-report-${runId.replace('manual-', 'run-')}.zip`)!
  expect(attachment.bytes).toBeGreaterThan(1000)
  expect(attachment.token).toBe('no-check')

  // Publishing again updates the same page.
  await page.getByRole('button', { name: 'Publish to Confluence' }).click()
  await expect(page.getByRole('button', { name: 'Confluence publications' })).toContainText('Published · v2', { timeout: 30_000 })
  expect((await confluenceWrites(request)).some(w => w.action === 'update' && w.version === 2)).toBeTruthy()

  await page.getByRole('button', { name: 'Confluence publications' }).click()
  await expect(page.getByRole('list', { name: 'Publications' }).getByRole('listitem')).toHaveCount(2)
  await expect(page.getByRole('list', { name: 'Publications' })).toContainText('E2E Automation Senior')
})

test('the report list shows the publication; users see it but cannot publish', async ({ page }) => {
  await login(page, 'automation_user')
  await page.goto('/reports/list')
  const row = page.getByRole('table', { name: 'Reports' }).getByRole('row').filter({ hasText: 'Login regression' }).first()
  await expect(row).toContainText('Published')
  await page.goto(`/reports/runs/${runId}`)
  await expect(page.getByRole('button', { name: 'Confluence publications' })).toContainText('Published · v2')
  await expect(page.getByRole('button', { name: 'Publish to Confluence' })).toHaveCount(0)
})
