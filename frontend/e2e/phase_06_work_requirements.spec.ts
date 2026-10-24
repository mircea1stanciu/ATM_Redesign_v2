import { expect, test, type APIRequestContext } from '@playwright/test'
import { authHeaders, fakeServicesUrl, login } from './helpers'

// Phase 06: work from Jira and Confluence (fake services in e2e/harness/fake-services.mjs). The senior has their own
// checkout, so starting work creates branches there without touching the shared one.

test.describe.configure({ mode: 'serial' })

test.beforeEach(({ page }) => {
  page.on('pageerror', error => {
    throw new Error(`Uncaught error in the page: ${error.message}`)
  })
})

async function sampleProjectId(request: APIRequestContext): Promise<string> {
  const projects = await (await request.get('/api/projects/', { headers: authHeaders('super_admin') })).json()
  return projects.find((p: { name: string }) => p.name === 'E2E Sample Project').id
}

async function jiraWrites(request: APIRequestContext): Promise<Array<{ key: string; action: string; body: Record<string, unknown> }>> {
  return (await (await request.get(`${fakeServicesUrl()}/__e2e/requests`)).json()).jiraWrites
}

const BRANCH = 'feature/E2E-1-login-shows-an-error-for-a'

test('the inbox lists the project\'s stories and opens one in the detail panel', async ({ page }) => {
  await login(page, 'automation_senior')
  await page.goto('/work')
  await expect(page).toHaveURL(/\/work\/inbox$/)
  const list = page.getByRole('list', { name: 'Jira stories' })
  await expect(list.getByRole('button', { name: /E2E-1/ })).toBeVisible()
  await expect(list.getByRole('button', { name: /E2E-2/ })).toBeVisible()
  await expect(list.getByRole('button', { name: /E2E-3/ })).toHaveCount(0) // a bug, not a story

  await page.getByRole('textbox', { name: 'Search stories' }).fill('checkout')
  await expect(page).toHaveURL(/q=checkout/)
  await expect(list.getByRole('button')).toHaveCount(1)
  await page.getByRole('textbox', { name: 'Search stories' }).fill('')
  await page.getByLabel('Type').selectOption('all')
  await expect(list.getByRole('button', { name: /E2E-3/ })).toBeVisible()

  await list.getByRole('button', { name: /E2E-1/ }).click()
  await expect(page).toHaveURL(/item=E2E-1/)
  const panel = page.getByRole('dialog', { name: /E2E-1 · Login shows an error/ })
  await expect(panel.getByText('As a shopper I see a clear message when my password is wrong.')).toBeVisible()
  await expect(panel.getByText('Given a wrong password, the message "Wrong email or password" is shown.')).toBeVisible()
  await expect(panel.getByText('Copy agreed with UX.')).toBeVisible()
  await expect(panel.getByText('login-error.png')).toBeVisible()
  await expect(panel.getByRole('link', { name: 'Open in Jira' })).toHaveAttribute('href', `${fakeServicesUrl()}/jira/browse/E2E-1`)

  // The panel is in the URL: a reload opens it again; Esc closes it.
  await page.reload()
  await expect(page.getByRole('dialog', { name: /E2E-1/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page).not.toHaveURL(/item=/)
})

test('start work: tests, branch, workspace with the story attached, Jira comment', async ({ page, request }) => {
  const projectId = await sampleProjectId(request)
  await login(page, 'automation_senior')
  await page.goto('/work/inbox?item=E2E-1')
  await page.getByRole('dialog', { name: /E2E-1/ }).getByRole('button', { name: 'Start work' }).click()

  const dialog = page.getByRole('dialog', { name: 'Start work on E2E-1' })
  await dialog.getByRole('checkbox', { name: 'tests/ui/login_error.spec.ts' }).check()
  await expect(dialog.getByLabel('Branch name')).toHaveValue(BRANCH)
  await expect(dialog.getByRole('checkbox', { name: 'Comment on E2E-1 in Jira that work started' })).toBeChecked()
  await dialog.getByRole('button', { name: 'Start work' }).click()

  await expect(page).toHaveURL(/\/work\/workspace\?tab=assistant&item=\d+$/)
  const story = page.getByRole('region', { name: 'Attached story' })
  await expect(story).toContainText('Story E2E-1 · Login shows an error for a wrong password')
  await expect(story).toContainText(BRANCH)
  await story.getByRole('button', { name: /Story E2E-1/ }).click()
  await expect(story).toContainText('Acceptance criteria:')

  // The branch exists and is checked out in the senior's checkout.
  const status = await (await request.get(`/api/projects/${projectId}/local/status`, { headers: authHeaders('automation_senior') })).json()
  expect(status.current_branch).toBe(BRANCH)
  const items = await (await request.get(`/api/projects/${projectId}/work/items`, { headers: authHeaders('automation_senior') })).json()
  const item = items.items.find((i: { external_key: string }) => i.external_key === 'E2E-1')
  expect(item).toMatchObject({ status: 'in_progress', branch: BRANCH })
  const writes = await jiraWrites(request)
  expect(writes.find(w => w.key === 'E2E-1' && w.action === 'comment')?.body.body).toContain(BRANCH)
})

test('the board shows the work item; trace links, Jira status and comment', async ({ page, request }) => {
  await login(page, 'automation_senior')
  await page.goto('/work/board')
  const inProgress = page.getByRole('region', { name: 'In progress' })
  await expect(inProgress.getByText('Login shows an error for a wrong password')).toBeVisible()

  await inProgress.getByRole('button', { name: /Login shows an error/ }).click()
  const panel = page.getByRole('dialog', { name: /E2E-1 · Login shows an error/ })
  await expect(panel.getByRole('list', { name: 'Trace links' })).toContainText('tests/ui/login_error.spec.ts')
  await panel.getByLabel('Link type').selectOption('run')
  await panel.getByLabel('Link target').fill('manual-42')
  await panel.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(panel.getByRole('list', { name: 'Trace links' })).toContainText('manual-42')

  await panel.getByLabel('Change the status in Jira').selectOption('21')
  await panel.getByRole('button', { name: 'Apply' }).click()
  await expect(page.getByText('E2E-1 moved to In Progress in Jira')).toBeVisible()
  await panel.getByLabel('Comment on the issue').fill('Login error tests added.')
  await panel.getByRole('button', { name: 'Post comment' }).click()
  await expect(page.getByText('Commented on E2E-1')).toBeVisible()
  const writes = await jiraWrites(request)
  expect(writes).toContainEqual({ key: 'E2E-1', action: 'transitions', body: { transition: { id: '21' } } })
  expect(writes).toContainEqual({ key: 'E2E-1', action: 'comment', body: { body: 'Login error tests added.' } })
  await page.keyboard.press('Escape')

  await inProgress.getByRole('button', { name: 'Move E2E-1' }).click()
  await page.getByRole('menuitem', { name: 'Move to In review' }).click()
  await expect(page.getByRole('region', { name: 'In review' }).getByText('Login shows an error for a wrong password')).toBeVisible()

  // Home lists the senior's own work.
  await page.goto('/')
  await expect(page.getByRole('link', { name: /E2E-1 Login shows an error/ })).toBeVisible()
})

test('Confluence pages are in the inbox too', async ({ page }) => {
  await login(page, 'automation_user')
  await page.goto('/work/inbox?source=confluence')
  const list = page.getByRole('list', { name: 'Confluence pages' })
  await expect(list.getByRole('button', { name: /Checkout requirements/ })).toBeVisible()
  await list.getByRole('button', { name: /Login requirements/ }).click()
  const panel = page.getByRole('dialog', { name: /102 · Login requirements/ })
  await expect(panel.getByText('Accounts lock after five wrong passwords.')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Start work' })).toBeVisible()
})

test('a viewer reads stories but cannot start work', async ({ page }) => {
  await login(page, 'viewer')
  await page.goto('/work/inbox?item=E2E-2')
  const panel = page.getByRole('dialog', { name: /E2E-2 · Checkout API/ })
  await expect(panel.getByText('POST /orders answers 201 with the new order id.')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Start work' })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Add to board' })).toHaveCount(0)
})

test('a lead sees the project\'s Jira project and Confluence space in Admin › Projects', async ({ page }) => {
  await login(page, 'automation_lead')
  await page.goto('/admin/projects')
  await expect(page.getByText('Jira: E2E · Confluence: E2E')).toBeVisible()
  await page.getByRole('button', { name: 'Edit E2E Sample Project' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit E2E Sample Project' })
  await expect(dialog.getByLabel('Jira project key')).toHaveValue('E2E')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Saved E2E Sample Project')).toBeVisible()
})
