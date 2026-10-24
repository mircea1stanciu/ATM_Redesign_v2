import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { authHeaders, fakeServicesUrl, login } from './helpers'

// Phase 07: the workspace (explorer, editor, hints, assistant) and its action bar: run changed tests, commit & push,
// open a PR. The trainee has their own checkout (harness), so these tests never touch the shared one.

test.describe.configure({ mode: 'serial' })

test.beforeEach(({ page }) => {
  page.on('pageerror', error => {
    throw new Error(`Uncaught error in the page: ${error.message}`)
  })
})

const FILE = 'tests/test_login_error.py'
const BRANCH = `feature/e2e-trainee-${Date.now()}`
const GIT_TIMEOUT = 20_000

async function sampleProjectId(request: APIRequestContext): Promise<string> {
  const projects = await (await request.get('/api/projects/', { headers: authHeaders('automation_trainee') })).json()
  return projects.find((p: { name: string }) => p.name === 'E2E Sample Project').id
}

async function openWorkspaceFile(page: Page) {
  await page.goto('/work/workspace')
  await page.getByRole('button', { name: 'tests', exact: true }).click()
  await page.getByRole('button', { name: 'test_login_error.py', exact: true }).click()
  await expect(page.locator('.cm-content')).toContainText("message = 'Wrong email or password'")
}

test('edit and save a file; the standard hint asks for an assertion', async ({ page }) => {
  await login(page, 'automation_trainee')
  await openWorkspaceFile(page)
  const toolbar = page.getByRole('toolbar', { name: 'Workspace actions' })
  await expect(toolbar).toContainText('0 uncommitted')

  const hints = page.getByRole('region', { name: 'Editor hints' })
  await expect(hints).toContainText('This test has no assertion yet')
  await toolbar.getByRole('switch', { name: 'Hints' }).click()
  await expect(page.getByText('This test has no assertion yet')).toHaveCount(0)
  await toolbar.getByRole('switch', { name: 'Hints' }).click()
  await expect(hints).toContainText('This test has no assertion yet')

  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText("def test_login_error_message():\n    message = 'Wrong email or password'\n    assert message\n")
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('This test has no assertion yet')).toHaveCount(0)
  await expect(toolbar).toContainText('1 uncommitted')

  // The explorer and the assistant can be hidden, and the choice is remembered.
  await toolbar.getByRole('button', { name: 'Hide assistant' }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Show assistant' })).toBeVisible()
  await page.getByRole('button', { name: 'Show assistant' }).click()
})

test('run changed tests: the changed pytest file runs and passes', async ({ page }) => {
  await login(page, 'automation_trainee')
  await page.goto('/work/workspace')
  await page.getByRole('button', { name: 'Run changed tests' }).click()
  const drawer = page.getByRole('dialog', { name: 'Run changed tests' })
  await drawer.getByRole('button', { name: 'Uncommitted', exact: true }).click()
  await expect(drawer.getByText(`pytest: ${FILE}`)).toBeVisible()
  await drawer.getByRole('button', { name: 'Run', exact: true }).click()
  await page.keyboard.press('Escape')

  const lastRun = page.getByRole('link', { name: 'Last run' })
  // One pytest test ran (the changed file) and passed.
  await expect(lastRun).toContainText('Passed', { timeout: 60_000 })
  await expect(lastRun).toContainText('1/1')
})

test('new branch, commit & push to the repository, open a pull request', async ({ page, request }) => {
  const projectId = await sampleProjectId(request)
  await login(page, 'automation_trainee')
  await page.goto('/work/workspace')
  const toolbar = page.getByRole('toolbar', { name: 'Workspace actions' })
  await expect(toolbar.getByRole('button', { name: 'Open PR' })).toBeDisabled() // still on main

  await toolbar.getByRole('button', { name: 'New branch' }).click()
  const branchDialog = page.getByRole('dialog', { name: 'New branch' })
  await branchDialog.getByLabel('Branch name').fill(BRANCH)
  await branchDialog.getByRole('button', { name: 'Create branch' }).click()
  // Git steps can take a while when every test runs at once.
  await expect(branchDialog).toBeHidden({ timeout: GIT_TIMEOUT })
  await expect(toolbar).toContainText(BRANCH)

  await toolbar.getByRole('button', { name: 'Commit & push' }).click()
  const commit = page.getByRole('dialog', { name: 'Commit & push' })
  await expect(commit.getByRole('list', { name: 'Changed files' })).toContainText(FILE)
  await commit.getByLabel('Commit message').fill('Add an assertion to the login error test')
  await commit.getByRole('button', { name: 'Commit & push' }).click()
  await expect(page.getByText(`Pushed ${BRANCH}`)).toBeVisible({ timeout: GIT_TIMEOUT })
  await expect(toolbar).toContainText('0 uncommitted')
  const branches = await (await request.get(`${fakeServicesUrl()}/api/v3/repos/e2e/sample/branches`)).json()
  expect(branches.map((b: { name: string }) => b.name)).toContain(BRANCH)

  await toolbar.getByRole('button', { name: 'Open PR' }).click()
  const pr = page.getByRole('dialog', { name: 'Open a pull request' })
  await pr.getByLabel('Title').fill('Login error test asserts the message')
  await pr.getByRole('button', { name: 'Open pull request' }).click()
  await expect(page.getByText(/Opened pull request #\d+/)).toBeVisible({ timeout: GIT_TIMEOUT })
  const { pullRequests } = await (await request.get(`${fakeServicesUrl()}/__e2e/requests`)).json()
  expect(pullRequests).toContainEqual(expect.objectContaining({ head: BRANCH, base: 'main', title: 'Login error test asserts the message' }))

  // Trainees push only the branches they started in ATM, never main.
  const pushMain = await request.post(`/api/projects/${projectId}/local/push`, {
    headers: authHeaders('automation_trainee'), data: { branch: 'main' },
  })
  expect(pushMain.status()).toBe(403)
})

test('review and accept a change proposed by the AI assistant (mocked provider)', async ({ page, request }) => {
  const projectId = await sampleProjectId(request)
  const saved = await request.put('/api/ai/settings', {
    headers: authHeaders('automation_trainee'),
    data: { provider: 'github', api_key: 'e2e-ai-key', model: 'openai/gpt-4.1' },
  })
  expect(saved.ok()).toBeTruthy()

  await login(page, 'automation_trainee')
  await openWorkspaceFile(page)
  await page.getByPlaceholder(/Ask the assistant to write or fix a test/).fill('Make this test check the message.')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText('The test has no assertion yet, so it can never fail. I added one.').first()).toBeVisible()

  await page.getByRole('button', { name: 'Review', exact: true }).last().click()
  await expect(page.getByRole('button', { name: /test_login_error\.py \(review\)/ })).toBeVisible()
  // Accept in the review tab (the chat card has its own Accept, which applies without a review).
  await page.locator('[data-pane="editor"]').getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(page.getByRole('button', { name: /\(review\)/ })).toHaveCount(0)

  const file = await (await request.get(`/api/projects/${projectId}/local/file`, {
    headers: authHeaders('automation_trainee'), params: { path: FILE },
  })).json()
  expect(file.content).toContain("assert message.startswith('Wrong')")
  const { aiRequests } = await (await request.get(`${fakeServicesUrl()}/__e2e/requests`)).json()
  expect(aiRequests.at(-1).last).toContain('Make this test check the message.')
})

test('the Repository screens are views of the workspace now', async ({ page }) => {
  await login(page, 'automation_trainee')
  await page.goto('/work/repository?view=compare')
  await expect(page).toHaveURL(/\/work\/workspace\?view=compare$/)
  await page.goto('/work/repository?view=scripts')
  await expect(page).toHaveURL(/\/tests\/scripts$/)
  await page.goto('/work/workspace?tab=analysis')
  await expect(page).toHaveURL(/view=analysis/)
  await expect(page.getByRole('tab', { name: 'Analysis' })).toHaveAttribute('aria-selected', 'true')
})
