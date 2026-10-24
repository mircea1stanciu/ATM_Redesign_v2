import { createHmac } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { authHeaders, fakeServicesUrl, login } from './helpers'

// Phase 11: a lead maps a service to the sample project (with a smoke check and a Teams channel); a signed CI/CD
// webhook announces a deployment; the project's tester sees it live, opens it, and sees the check pass.

test.describe.configure({ mode: 'serial', timeout: 180_000 })

test.beforeEach(({ page }) => {
  page.on('pageerror', error => {
    throw new Error(`Uncaught error in the page: ${error.message}`)
  })
})

const lead = authHeaders('automation_lead')
const SERVICE = `checkout-api-${Date.now().toString(36)}`
const ENVIRONMENT = 'UAT-P11'
const SUITE = 'Smoke after deploy'
const TITLE = `${SERVICE} 1.4.0 deployed to ${ENVIRONMENT}`
let secret = ''
let projectId = ''

function signed(body: string, key: string) {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = createHmac('sha256', key).update(`${timestamp}.${body}`).digest('hex')
  return { 'Content-Type': 'application/json', 'X-ATM-Timestamp': timestamp, 'X-ATM-Signature': `sha256=${signature}` }
}

async function teamsPosts(request: APIRequestContext): Promise<Array<{ title: string; text: string }>> {
  return (await (await request.get(`${fakeServicesUrl()}/__e2e/requests`)).json()).teamsPosts
}

test('the project has a smoke suite and an environment named like the deployment target', async ({ request }) => {
  const projects = await (await request.get('/api/projects/', { headers: lead })).json()
  projectId = projects.find((p: { name: string }) => p.name === 'E2E Sample Project').id
  // The check runs as the automation user, in their checkout: take the target from their detection.
  const detection = await (await request.get(`/api/projects/${projectId}/local/frameworks?refresh=true`,
    { headers: authHeaders('automation_user') })).json()
  const target = detection.frameworks.flatMap((f: { targets: Array<{ id: string; label: string }> }) => f.targets)
    .find((t: { label: string }) => t.label === 'tests/test_login_error.py')
  const suites = await (await request.get(`/api/suites/projects/${projectId}`, { headers: lead })).json()
  if (!suites.some((s: { name: string }) => s.name === SUITE)) {
    expect((await request.post(`/api/suites/projects/${projectId}/suites`, {
      headers: lead, data: { name: SUITE, test_type: 'smoke', target: target.id },
    })).ok()).toBeTruthy()
  }
  const environments = await (await request.get(`/api/projects/${projectId}/environments`, { headers: lead })).json()
  if (!environments.some((e: { name: string }) => e.name === ENVIRONMENT)) {
    expect((await request.post(`/api/projects/${projectId}/environments`, {
      headers: lead, data: { name: ENVIRONMENT, variables: { BASE_URL: 'https://uat.example.test' } },
    })).ok()).toBeTruthy()
  }
})

test('a lead connects Teams, adds the service, and chooses the check', async ({ page }) => {
  await login(page, 'automation_lead')
  await page.goto('/admin/projects')
  await page.getByRole('button', { name: 'Edit E2E Sample Project' }).click()
  await page.getByLabel('Microsoft Teams webhook (deployments)').fill(`${fakeServicesUrl()}/teams/hook`)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()

  await page.goto('/deployments/services')
  await page.getByRole('button', { name: 'New service' }).click()
  await page.getByLabel('Name').fill(SERVICE)
  await page.getByRole('button', { name: 'Save' }).click()
  const secretDialog = page.getByRole('dialog', { name: `Webhook for ${SERVICE}` })
  await expect(secretDialog.getByLabel('Webhook URL', { exact: true })).toHaveValue(/\/api\/deployments\/webhook$/)
  secret = await secretDialog.getByLabel('Secret', { exact: true }).inputValue()
  expect(secret.length).toBeGreaterThan(30)
  await expect(secretDialog).toContainText(`"service":"${SERVICE}"`)
  await secretDialog.getByRole('button', { name: 'Done' }).click()

  const card = page.getByRole('listitem').filter({ hasText: SERVICE })
  await card.getByRole('button', { name: 'Add project' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Project').selectOption({ label: 'E2E Sample Project' })
  await dialog.getByLabel('Smoke suite after each deployment (optional)').selectOption({ label: `${SUITE} (smoke)` })
  await dialog.getByLabel('Runs as').selectOption({ label: 'E2E Automation User' })
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
  const row = card.getByRole('table', { name: `Projects testing ${SERVICE}` }).getByRole('row', { name: /E2E Sample Project/ })
  await expect(row).toContainText(SUITE)
  await expect(row).toContainText('E2E Automation User')
})

test('a signed deployment notifies the tester live; the deployment shows who was told and the check', async ({ page, request }) => {
  // Send the deployment once the tab's notification socket is connected (the server greets with "hello").
  const connected = new Promise<void>(resolve => {
    page.on('websocket', socket => {
      if (!socket.url().includes('/api/ws/notifications')) return
      socket.on('framereceived', frame => { if (String(frame.payload).includes('"hello"')) resolve() })
    })
  })
  await login(page, 'automation_user')
  await connected

  const body = JSON.stringify({ service: SERVICE, version: '1.4.0', environment: ENVIRONMENT, source: 'Jenkins #42', commit: 'abc1234def' })
  expect((await request.post('/api/deployments/webhook', { data: body, headers: signed(body, 'not-the-secret') })).status()).toBe(401)
  const sent = await request.post('/api/deployments/webhook', { data: body, headers: signed(body, secret) })
  expect(sent.status()).toBe(202)

  // Pushed over the notification socket: a toast, and the bell lists it unread.
  await expect(page.getByText(TITLE).first()).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /^Notifications, \d+ unread/ }).click()
  await page.getByRole('list', { name: 'Notifications' }).getByRole('button', { name: new RegExp(TITLE) }).click()
  await expect(page).toHaveURL(/\/deployments\/\d+$/)
  await expect(page.getByRole('heading', { name: `${SERVICE} 1.4.0 → ${ENVIRONMENT}` })).toBeVisible()
  await expect(page.getByText('Jenkins #42', { exact: true })).toBeVisible()
  const notified = page.getByRole('list', { name: 'Notified testers' })
  for (const name of ['E2E Automation User', 'E2E Automation Trainee', 'E2E Automation Lead']) {
    await expect(notified.getByRole('listitem').filter({ hasText: name })).toHaveCount(1)
  }
  await expect(notified.getByRole('listitem').filter({ hasText: 'E2E Automation User' })).toContainText('Seen')
  await expect(page.getByText('E2E Viewer')).toHaveCount(0) // viewers are not testers

  // The smoke suite ran on UAT-P11 as the automation user and passed.
  const check = page.getByRole('list', { name: 'Checks' }).getByRole('listitem').filter({ hasText: 'E2E Sample Project' })
  await expect(check).toContainText(SUITE)
  await expect(check).toContainText('Passed', { timeout: 120_000 })
  await expect.poll(async () => (await (await request.get('/api/notifications', { headers: authHeaders('automation_user') })).json())
    .items.map((n: { title: string }) => n.title), { timeout: 15_000 })
    .toContain(`Smoke check passed: ${SERVICE} 1.4.0 on ${ENVIRONMENT}`)

  // The project's Teams channel got the deployment and the check.
  await expect.poll(async () => (await teamsPosts(request)).map(p => p.title), { timeout: 15_000 })
    .toEqual(expect.arrayContaining([TITLE, `Smoke check passed: ${SERVICE} 1.4.0 on ${ENVIRONMENT}`]))
})

test('viewers see the timeline and the service map but configure nothing', async ({ page }) => {
  await login(page, 'viewer')
  await page.goto('/deployments')
  await expect(page).toHaveURL(/\/deployments\/timeline/)
  await page.getByRole('group', { name: 'Environment' }).getByRole('button', { name: ENVIRONMENT }).click()
  const row = page.getByRole('table', { name: 'Deployments' }).getByRole('row').filter({ hasText: SERVICE })
  await expect(row).toContainText('1.4.0')
  await expect(row).toContainText('Passed')
  await page.getByRole('link', { name: 'Services' }).click()
  await expect(page.getByRole('list', { name: 'Services' })).toContainText(SERVICE)
  await expect(page.getByRole('button', { name: 'New service' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add project' })).toHaveCount(0)
})

test('the notification settings mute a kind', async ({ page }) => {
  await login(page, 'automation_trainee')
  await page.goto('/notifications')
  await expect(page.getByRole('list', { name: 'Notifications' })).toContainText(TITLE)
  const toggle = page.getByRole('switch', { name: 'Deployments to my projects\' test environments' })
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await page.reload()
  await expect(page.getByRole('switch', { name: 'Deployments to my projects\' test environments' })).not.toBeChecked()
})
