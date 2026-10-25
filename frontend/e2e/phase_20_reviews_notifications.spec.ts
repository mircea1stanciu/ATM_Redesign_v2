import { createHmac } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { authHeaders, fakeServicesUrl, fakeSmtpPort, login } from './helpers'

// Phase 20 (from the decisions review): the author of a pull request asks people and a team for a review on GitHub;
// a line comment reaches GitHub at once, before the review is submitted; a Super Admin sets up e-mail, and a tester
// gets a deployment by e-mail and in their own Teams chat.

test.describe.configure({ mode: 'serial', timeout: 120_000 })

test.beforeEach(({ page }) => {
  page.on('pageerror', error => {
    throw new Error(`Uncaught error in the page: ${error.message}`)
  })
})

const SUFFIX = Date.now().toString(36)
const TITLE = `Checkout test checks the total ${SUFFIX}`
const FILE = `tests/test_checkout_${SUFFIX}.py`
let prNumber = 0
let prPath = ''

type Requests = {
  reviewerRequests: Array<{ number: number; login: string; reviewers: string[]; teams: string[] }>
  lineCommentWrites: Array<{ number: number; login: string; path: string; line: number; body: string; reviewsBefore: number }>
  reviewWrites: Array<{ number: number; login: string; event: string; body: string; comments: unknown[] }>
  emails: Array<{ from: string; to: string[]; subject: string; text: string }>
  teamsPosts: Array<{ title: string; for: string | null }>
}

async function sent(request: APIRequestContext): Promise<Requests> {
  return (await request.get(`${fakeServicesUrl()}/__e2e/requests`)).json()
}

async function sampleProjectId(request: APIRequestContext): Promise<number> {
  const projects = await (await request.get('/api/projects/', { headers: authHeaders('automation_lead') })).json()
  return projects.find((p: { name: string }) => p.name === 'E2E Sample Project').id
}

test('the author asks people and a team on GitHub for a review', async ({ page, request }) => {
  const opened = await request.post(`${fakeServicesUrl()}/__e2e/pull-request`, {
    data: {
      branch: `review/checkout-${SUFFIX}`, path: FILE, title: TITLE, author: 'e2e-bot', requested: [],
      content: 'def test_checkout_total():\n    total = 40 + 2\n    assert total == 42\n',
    },
  })
  prNumber = (await opened.json()).number
  prPath = `/reviews/${await sampleProjectId(request)}/${prNumber}`

  await login(page, 'automation_user') // GitHub user e2e-bot, the author
  await page.goto(prPath)
  await expect(page.getByText('Nobody is asked on GitHub.')).toBeVisible()
  await page.getByRole('button', { name: 'Request reviewers' }).click()
  const dialog = page.getByRole('dialog', { name: 'Request reviewers' })
  await expect(dialog.getByRole('checkbox', { name: 'e2e-lead', exact: true })).toBeVisible()
  await expect(dialog.getByRole('checkbox', { name: 'e2e-bot', exact: true })).toHaveCount(0) // not the author
  await dialog.getByRole('checkbox', { name: 'e2e-senior', exact: true }).check()
  await dialog.getByRole('checkbox', { name: 'QA team (team)' }).check()
  await dialog.getByRole('button', { name: 'Request', exact: true }).click()
  await expect(dialog).toBeHidden()

  const requested = page.getByRole('list', { name: 'Requested reviewers' })
  await expect(requested).toContainText('e2e-senior')
  await expect(requested).toContainText('qa-team (team)')
  expect((await sent(request)).reviewerRequests).toContainEqual({ number: prNumber, login: 'e2e-bot', reviewers: ['e2e-senior'], teams: ['qa-team'] })
})

test('the senior\'s line comment reaches GitHub before the review is submitted', async ({ page, request }) => {
  await login(page, 'automation_senior')
  await page.goto('/reviews/waiting')
  await page.getByRole('list', { name: 'Pull requests' }).getByRole('link', { name: TITLE }).click()
  await expect(page).toHaveURL(new RegExp(`${prPath}$`))

  const diff = page.getByRole('table', { name: `Diff of ${FILE}` })
  await diff.getByRole('button', { name: `Comment on line 2 of ${FILE}` }).click()
  await page.getByRole('textbox', { name: `Comment on line 2 of ${FILE}` }).fill('Name the numbers: price and shipping.')
  await page.getByRole('button', { name: 'Post comment' }).click()
  await expect(page.getByRole('textbox', { name: `Comment on line 2 of ${FILE}` })).toBeHidden() // posted
  await expect(diff).toContainText('Name the numbers: price and shipping.') // read back from GitHub

  const posted = (await sent(request)).lineCommentWrites.find(c => c.number === prNumber && c.login === 'e2e-senior')!
  expect(posted).toMatchObject({ path: FILE, line: 2, body: 'Name the numbers: price and shipping.', reviewsBefore: 0 })

  await page.getByLabel('Review summary').fill('Fine once the numbers have names.')
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect.poll(async () => (await sent(request)).reviewWrites.find(w => w.number === prNumber && w.login === 'e2e-senior'))
    .toMatchObject({ event: 'APPROVE', body: 'Fine once the numbers have names.', comments: [] })
})

test('a Super Admin sets up e-mail; a tester gets a deployment by e-mail and in their own Teams chat', async ({ page, request }) => {
  await login(page, 'super_admin')
  await page.goto('/admin/email')
  await page.getByLabel('SMTP server').fill('127.0.0.1')
  await page.getByLabel('Security').selectOption('none')
  await page.getByLabel('Port').fill(String(fakeSmtpPort()))
  await page.getByLabel('Sender address').fill('atm@e2e.test')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('button', { name: 'Send me a test e-mail' }).click()
  await expect.poll(async () => (await sent(request)).emails.some(m => m.subject === 'ATM test e-mail' && m.to.includes('e2e_super_admin@e2e.test')))
    .toBe(true)

  const hook = `secrets_tester-${SUFFIX}`
  await login(page, 'secrets_tester')
  await page.goto('/notifications')
  await page.getByLabel('My Teams workflow webhook').fill(`${fakeServicesUrl()}/teams/hook?for=${hook}`)
  await page.getByRole('button', { name: 'Save webhook' }).click()
  await page.getByRole('checkbox', { name: 'Deployments to my projects\' test environments: by e-mail' }).check()
  await page.getByRole('checkbox', { name: 'Deployments to my projects\' test environments: in Teams' }).check()
  await expect.poll(async () => (await (await request.get('/api/notifications/subscriptions', { headers: authHeaders('secrets_tester') })).json())
    .kinds.find((k: { kind: string }) => k.kind === 'deployment')).toMatchObject({ on: true, email: true, teams: true })

  // A deployment of a service the sample project tests, announced by a signed CI/CD webhook.
  const lead = authHeaders('automation_lead')
  const service = await (await request.post('/api/deployments/services', { headers: lead, data: { name: `cart-api-${SUFFIX}` } })).json()
  expect((await request.put(`/api/deployments/services/${service.id}/projects/${await sampleProjectId(request)}`, { headers: lead, data: {} })).ok()).toBeTruthy()
  const body = JSON.stringify({ service: service.name, version: '2.0.0', environment: 'UAT-P20' })
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = createHmac('sha256', service.secret).update(`${timestamp}.${body}`).digest('hex')
  expect((await request.post('/api/deployments/webhook', {
    data: body, headers: { 'Content-Type': 'application/json', 'X-ATM-Timestamp': timestamp, 'X-ATM-Signature': `sha256=${signature}` },
  })).status()).toBe(202)

  const title = `${service.name} 2.0.0 deployed to UAT-P20`
  await expect.poll(async () => (await sent(request)).emails.some(m => m.subject === title && m.to.includes('secrets_tester@e2e.test')),
    { timeout: 15_000 }).toBe(true)
  await expect.poll(async () => (await sent(request)).teamsPosts.some(p => p.title === title && p.for === hook), { timeout: 15_000 }).toBe(true)
})
