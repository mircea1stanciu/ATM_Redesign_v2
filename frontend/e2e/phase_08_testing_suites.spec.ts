import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { authHeaders, login } from './helpers'

// Phase 08: suites (test type, target, environment, schedule), environments, the run dialog, the scheduler and the
// performance view. The sample repository has a pytest test and a k6 script; k6 is a stand-in on PATH (harness).

test.describe.configure({ mode: 'serial', timeout: 120_000 }) // runs execute for real

test.beforeEach(({ page }) => {
  page.on('pageerror', error => {
    throw new Error(`Uncaught error in the page: ${error.message}`)
  })
})

const RUN_TIMEOUT = 60_000

async function sampleProjectId(request: APIRequestContext): Promise<string> {
  const projects = await (await request.get('/api/projects/', { headers: authHeaders('automation_user') })).json()
  return projects.find((p: { name: string }) => p.name === 'E2E Sample Project').id
}

async function createSuite(page: Page, name: string, type: string, target: string) {
  await page.getByRole('button', { name: 'New suite' }).click()
  const dialog = page.getByRole('dialog', { name: 'New suite' })
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByLabel('Test type').selectOption(type)
  await expect(dialog.getByLabel('What it runs').locator('option', { hasText: target })).toHaveCount(1, { timeout: 20_000 })
  await dialog.getByLabel('What it runs').selectOption({ label: target })
  await dialog.getByLabel('Environment').selectOption({ label: 'UAT' })
  await dialog.getByRole('button', { name: 'Create suite' }).click()
  await expect(dialog).toBeHidden()
}

test('environments: a lead adds UAT; users see it but cannot change it', async ({ page, request }) => {
  const projectId = await sampleProjectId(request)
  const created = await request.post(`/api/projects/${projectId}/environments`, {
    headers: authHeaders('automation_lead'), data: { name: 'UAT', variables: { BASE_URL: 'http://uat.e2e.test' } },
  })
  expect(created.status()).toBe(201)

  await login(page, 'automation_user')
  await page.goto('/tests/environments')
  await expect(page.getByRole('list', { name: 'Environments' })).toContainText('BASE_URL=http://uat.e2e.test')
  await expect(page.getByRole('button', { name: 'New environment' })).toHaveCount(0)
})

test('create suites of each test type', async ({ page, request }) => {
  const projectId = await sampleProjectId(request)
  await login(page, 'automation_user')
  await page.goto('/tests/suites')
  await createSuite(page, 'Login checks', 'functional', 'tests/test_login_error.py')
  await createSuite(page, 'Load', 'performance', 'perf/load.js')
  for (const type of ['regression', 'smoke', 'api', 'ui', 'mobile']) {
    const response = await request.post(`/api/suites/projects/${projectId}/suites`, {
      headers: authHeaders('automation_user'), data: { name: `E2E ${type}`, test_type: type },
    })
    expect(response.ok()).toBeTruthy()
  }
  await page.reload()
  const list = page.getByRole('list', { name: 'Suites' })
  for (const type of ['functional', 'regression', 'smoke', 'api', 'ui', 'mobile', 'performance']) {
    await expect(list.getByText(type, { exact: true }).first()).toBeVisible()
  }
  await expect(list).toContainText('perf/load.js')
  // A suite without a target cannot run yet.
  await expect(page.getByRole('button', { name: 'Run E2E smoke' })).toBeDisabled()
})

test('run a functional suite from the run dialog', async ({ page }) => {
  await login(page, 'automation_user')
  await page.goto('/tests/suites')
  await page.getByRole('button', { name: 'Run Login checks' }).click()
  const dialog = page.getByRole('dialog', { name: 'Run tests' })
  await expect(dialog.getByLabel('Suite', { exact: true })).toHaveValue(/\d+/)
  await expect(dialog.getByLabel('Environment')).not.toHaveValue('') // the suite's own environment
  await dialog.getByRole('button', { name: 'Start' }).click()
  await expect(page).toHaveURL(/\/tests\/runs$/)

  await page.goto('/tests/suites')
  await expect(page.getByLabel('Last run of Login checks')).toContainText('Passed', { timeout: RUN_TIMEOUT })
})

test('run a performance suite and see its response times', async ({ page }) => {
  await login(page, 'automation_user')
  await page.goto('/tests/runs')
  await page.getByRole('button', { name: 'Run tests' }).click() // the Tests area's action, on every tab
  const dialog = page.getByRole('dialog', { name: 'Run tests' })
  await dialog.getByLabel('Suite', { exact: true }).selectOption({ label: 'Load' })
  await dialog.getByRole('button', { name: 'Start' }).click()
  await expect(page).toHaveURL(/\/tests\/runs$/)

  await page.getByRole('button', { name: 'Run details' }).click()
  const performance = page.getByRole('region', { name: 'Performance' })
  await expect(performance).toContainText('143 ms', { timeout: RUN_TIMEOUT }) // p95 from the k6 summary
  await expect(performance).toContainText('19.8 req/s')
  await expect(performance).toContainText('0.00 %')
})

test('schedule a suite and see it start', async ({ page }) => {
  await login(page, 'automation_user')
  await page.goto('/tests/suites')
  await page.getByRole('button', { name: 'Edit Login checks' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit Login checks' })
  await dialog.getByLabel('Schedule').selectOption('custom')
  await dialog.getByLabel('Cron expression').fill('* * * * *')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()

  // The scheduler checks every 2 s in the UI tests: an every-minute schedule is due at once.
  await expect(page.getByLabel('Last run of Login checks').getByLabel('Scheduled')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByLabel('Last run of Login checks')).toContainText('Passed', { timeout: RUN_TIMEOUT })

  // Switch the schedule off again, so it does not keep running for the rest of the UI tests.
  await page.getByRole('button', { name: 'Edit Login checks' }).click()
  await page.getByRole('dialog', { name: 'Edit Login checks' }).getByLabel('Schedule').selectOption('')
  await page.getByRole('dialog', { name: 'Edit Login checks' }).getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('list', { name: 'Suites' })).toContainText('Not scheduled')
})

test('users manage only their own suites; trainees cannot create suites', async ({ page }) => {
  await login(page, 'automation_trainee')
  await page.goto('/tests/suites')
  await expect(page.getByRole('list', { name: 'Suites' })).toContainText('Login checks')
  await expect(page.getByRole('button', { name: 'New suite' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Edit Login checks' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Run Login checks' })).toBeVisible() // trainees may run tests
})
