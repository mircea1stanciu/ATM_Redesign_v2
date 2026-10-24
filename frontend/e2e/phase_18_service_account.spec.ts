import { expect, test, type APIRequestContext } from '@playwright/test'
import { authHeaders, fakeServicesUrl, login } from './helpers'

// Phase 18 (from the decisions review): a project's ATM service account runs its schedules in a checkout ATM keeps,
// so a schedule set by someone without a checkout (here the lead) still runs. A project of its own keeps the other
// specs' schedules as they are.

test.describe.configure({ mode: 'serial', timeout: 150_000 })

test.beforeEach(({ page }) => {
  page.on('pageerror', error => {
    throw new Error(`Uncaught error in the page: ${error.message}`)
  })
})

const lead = authHeaders('automation_lead')
const PROJECT = `Scheduled P18 ${Date.now().toString(36)}`
let projectId = ''
let suiteId = ''

async function targetId(request: APIRequestContext): Promise<string> {
  // Target ids are relative to the repository: take it from a checkout of the same repository.
  const projects = await (await request.get('/api/projects/', { headers: authHeaders('automation_user') })).json()
  const sample = projects.find((p: { name: string }) => p.name === 'E2E Sample Project').id
  const detection = await (await request.get(`/api/projects/${sample}/local/frameworks`, { headers: authHeaders('automation_user') })).json()
  return detection.frameworks.flatMap((f: { targets: Array<{ id: string; label: string }> }) => f.targets)
    .find((t: { label: string }) => t.label === 'tests/test_login_error.py').id
}

test('a lead sets up the service account of a project', async ({ page, request }) => {
  const created = await request.post('/api/projects/', { headers: lead, data: { name: PROJECT, git_repo_url: `${fakeServicesUrl()}/e2e/sample.git` } })
  expect(created.ok()).toBeTruthy()
  projectId = (await created.json()).id

  await login(page, 'automation_lead')
  await page.goto('/admin/projects')
  await page.getByRole('button', { name: `Edit ${PROJECT}` }).click()
  const section = page.getByRole('region', { name: 'Service account' })
  await section.getByLabel('Service account GitHub token').fill('e2e-service-token')
  await section.getByRole('button', { name: 'Set token' }).click()
  await expect(section).toContainText('Set up')
  await expect(section).toContainText('last synced')
})

test('a schedule set by the lead (who has no checkout) runs with the service account', async ({ request }) => {
  const suite = await request.post(`/api/suites/projects/${projectId}/suites`, {
    headers: lead, data: { name: 'Every minute', target: await targetId(request), cron_expression: '* * * * *' },
  })
  expect(suite.ok()).toBeTruthy()
  suiteId = (await suite.json()).id
  const runs = async () => (await (await request.get(`/api/runs/projects/${projectId}`, { headers: lead })).json()) as
    Array<{ status: string; trigger: string; triggered_by: string }>
  await expect.poll(async () => (await runs()).find(r => r.trigger === 'schedule')?.status, { timeout: 120_000, intervals: [2000] })
    .toBe('passed')
  expect((await runs()).find(r => r.trigger === 'schedule')!.triggered_by).toBe('schedule')
})

test('removing the service account stops using its checkout', async ({ page, request }) => {
  await request.post(`/api/suites/${suiteId}/archive`, { headers: lead }) // stop the schedule
  await login(page, 'automation_lead')
  await page.goto('/admin/projects')
  await page.getByRole('button', { name: `Edit ${PROJECT}` }).click()
  const section = page.getByRole('region', { name: 'Service account' })
  await section.getByRole('button', { name: 'Remove' }).click()
  await expect(section.getByText('Set up', { exact: true })).toHaveCount(0)
  expect((await (await request.get(`/api/projects/${projectId}/service-account`, { headers: lead })).json()).configured).toBe(false)
})
