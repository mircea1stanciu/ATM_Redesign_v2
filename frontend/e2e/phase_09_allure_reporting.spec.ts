import { expect, test, type APIRequestContext } from '@playwright/test'
import { authHeaders, login } from './helpers'

// Phase 09: every run gets a real Allure report (allure generate, with history), viewed inside ATM; Reports lists
// them and draws trends. The sample repository has a Playwright project (run for real) and a Bruno collection (the
// Bruno CLI is a stand-in, e2e/harness/start-backend.mjs).

test.describe.configure({ mode: 'serial', timeout: 180_000 })

test.beforeEach(({ page }) => {
  page.on('pageerror', error => {
    throw new Error(`Uncaught error in the page: ${error.message}`)
  })
})

const headers = authHeaders('automation_user')
let projectId = ''
let playwrightSuite = ''
const runs: Record<string, string> = {}

async function waitForRun(request: APIRequestContext, runId: string) {
  await expect.poll(async () => {
    const run = await (await request.get(`/api/runs/${runId}`, { headers })).json()
    return run.status
  }, { timeout: 120_000, intervals: [1000] }).toMatch(/passed|failed|error/)
  // The report is generated right after the results are saved.
  await expect.poll(async () => (await request.post(`/api/runs/${runId}/report-link`, { headers })).status(),
    { timeout: 60_000, intervals: [1000] }).toBe(200)
}

test('a Playwright suite and a Bruno collection run, twice for Playwright', async ({ request }) => {
  const projects = await (await request.get('/api/projects/', { headers })).json()
  projectId = projects.find((p: { name: string }) => p.name === 'E2E Sample Project').id

  const detection = await (await request.get(`/api/projects/${projectId}/local/frameworks?refresh=true`, { headers })).json()
  const target = detection.frameworks.flatMap((f: { targets: Array<{ id: string; label: string }> }) => f.targets)
    .find((t: { label: string }) => t.label === 'pw/cart.spec.ts')
  expect(target, 'the Playwright sample is detected').toBeTruthy()
  const suite = await (await request.post(`/api/suites/projects/${projectId}/suites`, {
    headers, data: { name: 'Cart (Playwright)', test_type: 'ui', target: target.id },
  })).json()
  playwrightSuite = suite.id
  for (const key of ['playwright1', 'playwright2']) {
    const started = await (await request.post(`/api/suites/${suite.id}/runs`, { headers, data: {} })).json()
    runs[key] = started.run.id
    await waitForRun(request, runs[key])
  }

  const bruno = await (await request.post(`/api/suites/projects/${projectId}/suites`, {
    headers, data: { name: 'Health (Bruno)', test_type: 'api' },
  })).json()
  const run = await (await request.post('/api/runs', { headers, data: { suite_id: bruno.id, collection: 'bruno-api' } })).json()
  const executed = await request.post(`/api/runs/${run.id}/execute`, {
    headers, data: { run_collection: 'bruno-api', run_environment: 'uat' },
  })
  expect(executed.ok(), await executed.text()).toBeTruthy()
  runs.bruno = run.id
  await waitForRun(request, runs.bruno)
})

test('Reports lists the runs and opens both Allure reports inside ATM', async ({ page }) => {
  await login(page, 'automation_user')
  await page.goto('/reports')
  await expect(page).toHaveURL(/\/reports\/list$/)
  const table = page.getByRole('table', { name: 'Reports' })
  await expect(table.getByRole('row').filter({ hasText: 'Cart (Playwright)' })).toHaveCount(2)
  await expect(table.getByRole('row').filter({ hasText: 'Health (Bruno)' }).first()).toContainText('100 %')

  const reports: Array<[string, string, string]> = [
    [runs.playwright2, 'Cart (Playwright)', 'adds an item to the cart'],
    [runs.bruno, 'Health (Bruno)', 'health'],
  ]
  for (const [runId, suite, testName] of reports) {
    await page.goto(`/reports/runs/${runId}`)
    const report = page.frameLocator(`iframe[title="Allure report of ${runId}"]`)
    // Allure's own app, rendered from data/*.json loaded inside the sandboxed iframe.
    await expect(report.getByText('Allure', { exact: false }).first()).toBeVisible({ timeout: 30_000 })
    await report.getByText('Suites', { exact: true }).first().click()
    // The tree: the suite, then the test file / class group, then the tests.
    await report.getByText(suite, { exact: true }).click()
    await report.locator('.node__title').nth(1).click()
    await expect(report.getByText(testName, { exact: false }).first()).toBeVisible({ timeout: 15_000 })
  }
  await expect(page.getByRole('link', { name: 'Open in a new tab' })).toHaveAttribute('href', /\/api\/reports\/view\//)
})

test('the trend shows two points after two runs', async ({ page }) => {
  await login(page, 'automation_user')
  await page.goto(`/reports/trends?suite=${playwrightSuite}`)
  await expect(page.getByRole('heading', { name: 'Runs (2)' })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Trend points' }).getByRole('row')).toHaveCount(3) // header + 2
  await expect(page.getByRole('heading', { name: 'Pass rate' })).toBeVisible()
})

test('report files are sandboxed and a link serves only its own report', async ({ request }) => {
  const url = (await (await request.post(`/api/runs/${runs.bruno}/report-link`, { headers })).json()).url as string
  const page = await request.get(url)
  expect(page.status()).toBe(200)
  expect(page.headers()['content-security-policy']).toContain('sandbox allow-scripts')
  expect((await request.get(url.replace('index.html', '../../../etc/passwd'))).status()).toBe(404)
})
