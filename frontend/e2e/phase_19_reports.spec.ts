import { expect, test, type APIRequestContext } from '@playwright/test'
import { authHeaders, fakeServicesUrl, login } from './helpers'

// Phase 19 (from the decisions review): a suite publishes every run to Confluence automatically; a report is
// downloaded as a zip and shared with a link that needs no sign-in until a lead revokes it; a lead deletes a report.

test.describe.configure({ mode: 'serial', timeout: 180_000 })

test.beforeEach(({ page }) => {
  page.on('pageerror', error => {
    throw new Error(`Uncaught error in the page: ${error.message}`)
  })
})

const senior = authHeaders('automation_senior')
const SUITE = `P19 auto ${Date.now().toString(36)}`
let runId = ''
let shared = ''

async function confluenceTitles(request: APIRequestContext): Promise<string[]> {
  const { confluenceWrites } = await (await request.get(`${fakeServicesUrl()}/__e2e/requests`)).json()
  return confluenceWrites.filter((w: { action: string }) => w.action === 'create').map((w: { title: string }) => w.title)
}

test('a senior switches on automatic publishing; the next run is published', async ({ page, request }) => {
  const projects = await (await request.get('/api/projects/', { headers: senior })).json()
  const projectId = projects.find((p: { name: string }) => p.name === 'E2E Sample Project').id
  const detection = await (await request.get(`/api/projects/${projectId}/local/frameworks?refresh=true`, { headers: senior })).json()
  const target = detection.frameworks.flatMap((f: { targets: Array<{ id: string; label: string }> }) => f.targets)
    .find((t: { label: string }) => t.label === 'tests/test_login_error.py')
  const suite = await (await request.post(`/api/suites/projects/${projectId}/suites`, {
    headers: senior, data: { name: SUITE, test_type: 'regression', target: target.id },
  })).json()

  await login(page, 'automation_senior')
  await page.goto('/tests/suites')
  await page.getByRole('checkbox', { name: `Publish ${SUITE} to Confluence automatically` }).check()
  await expect(page.getByText(`${SUITE}: every run is published to Confluence`)).toBeVisible()

  runId = (await (await request.post(`/api/suites/${suite.id}/runs`, { headers: senior, data: {} })).json()).run.id
  await expect.poll(() => confluenceTitles(request), { timeout: 120_000, intervals: [2000] })
    .toContain(`E2E Sample Project · ${SUITE} · Test report`)
})

test('the report downloads as a zip and is shared with a link that needs no sign-in', async ({ page, browser }) => {
  await login(page, 'automation_senior')
  await page.goto(`/reports/runs/${runId}`)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download report (zip)' }).click()
  expect((await download).suggestedFilename()).toBe(`allure-report-${runId.replace('manual-', 'run-')}.zip`)

  await page.getByRole('button', { name: 'Share link' }).click()
  await page.getByRole('button', { name: 'Create a share link' }).click()
  shared = await page.getByLabel('Share link', { exact: true }).inputValue()
  expect(shared).toMatch(/\/api\/reports\/shared\/[\w-]+\/index\.html$/)

  const stranger = await browser.newContext() // nobody signed in
  const response = await (await stranger.newPage()).goto(shared)
  expect(response?.status()).toBe(200)
  await stranger.close()
})

test('a lead revokes the share link, then deletes the report', async ({ page, request }) => {
  await login(page, 'automation_lead')
  await page.goto('/reports/share-links')
  const row = page.getByRole('table', { name: 'Share links' }).getByRole('row').filter({ hasText: SUITE })
  await expect(row).toContainText('1') // viewed once
  await row.getByRole('button', { name: /^Revoke the share link/ }).click()
  await expect(row).toHaveCount(0)
  expect((await request.get(shared)).status()).toBe(404)

  await page.goto(`/reports/runs/${runId}`)
  await page.getByRole('button', { name: 'Delete report' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete report' }).click()
  await expect(page).toHaveURL(/\/reports\/list$/)
  await expect(page.getByRole('table', { name: 'Reports' }).getByRole('row').filter({ hasText: SUITE })).toContainText('Deleted')
})
