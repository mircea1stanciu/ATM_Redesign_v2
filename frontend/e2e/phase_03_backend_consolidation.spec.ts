import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { authHeaders, fakeServicesUrl, login } from './helpers'

// Phase 03 moved the features the UI needs into the one backend. Publish, Scripts run and the Jira/Confluence
// settings used to answer 404 or depend on the removed second backend; they now work against fake services.

test.beforeEach(({ page }) => {
  page.on('pageerror', error => {
    throw new Error(`Uncaught error in the page: ${error.message}`)
  })
  page.on('dialog', dialog => void dialog.accept())
})

/**
 * Open a connection settings page and wait until every load has finished: the panel and the connection-status
 * check both fetch the saved values, and the panel's response replaces whatever is typed in the form.
 */
async function openConnectionSettings(page: Page, kind: 'jira' | 'confluence') {
  await page.goto(`/settings/mcp/${kind}`)
  await page.waitForLoadState('networkidle')
}

async function sampleProjectId(request: APIRequestContext): Promise<string> {
  const projects = await (await request.get('/api/projects/', { headers: authHeaders('super_admin') })).json()
  return projects.find((p: { name: string }) => p.name === 'E2E Sample Project').id
}

test('Publish: branch, commit, push to the repository and open a pull request', async ({ page, request }) => {
  const projectId = await sampleProjectId(request)
  const branch = `feature/e2e-${Date.now()}`
  // A change to publish, written through the editor API.
  const saved = await request.put(`/api/projects/${projectId}/local/file`, {
    headers: authHeaders('super_admin'),
    data: { path: `notes/${branch.replace('/', '-')}.txt`, content: 'Written by the UI test.\n' },
  })
  expect(saved.ok()).toBeTruthy()

  await login(page, 'super_admin')
  await page.goto('/projects/repository')
  await page.getByRole('button', { name: 'Publish', exact: true }).click()

  await page.getByLabel('New branch name').fill(branch)
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByText(`Created and switched to “${branch}”.`)).toBeVisible()

  await page.getByLabel('Commit message').fill('Add a note from the UI test')
  await page.getByRole('button', { name: 'Commit all changes' }).click()
  await expect(page.getByText('Changes committed locally.')).toBeVisible()

  await page.getByRole('button', { name: `Push “${branch}” to GitHub` }).click()
  await expect(page.getByText(`Pushed “${branch}” to GitHub.`)).toBeVisible()

  await page.getByLabel('Pull request title').fill('UI test pull request')
  await page.getByRole('button', { name: 'Create pull request' }).click()
  await expect(page.getByText(/Pull request #\d+ created\./)).toBeVisible()

  // The branch really reached the repository, and GitHub got the pull request request.
  const branches = await (await request.get(`${fakeServicesUrl()}/api/v3/repos/e2e/sample/branches`)).json()
  expect(branches.map((b: { name: string }) => b.name)).toContain(branch)
  const { pullRequests } = await (await request.get(`${fakeServicesUrl()}/__e2e/requests`)).json()
  expect(pullRequests).toContainEqual(expect.objectContaining({
    head: branch, base: 'main', title: 'UI test pull request', authorization: 'token e2e-github-token',
  }))
})

test('Scripts: run a script from the checkout and see its output', async ({ page }) => {
  await login(page, 'super_admin')
  await page.goto('/projects/repository')
  await page.getByRole('button', { name: 'Scripts', exact: true }).click()

  await expect(page.getByText('hello.sh', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('hello from ATM e2e')).toBeVisible()
})

test('Jira settings: save a token, test the connection, list projects', async ({ page, request }) => {
  await login(page, 'super_admin')
  await openConnectionSettings(page, 'jira')

  await page.getByLabel('Jira Token').fill('e2e-jira-token-1234')
  await page.getByLabel('Jira Base URL').fill(`${fakeServicesUrl()}/jira`)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('•••• 1234')).toBeVisible()

  await page.getByRole('button', { name: 'Test Connection' }).click()
  await expect(page.getByText('Authenticated as E2E Jira User.')).toBeVisible()
  await expect(page.getByText('E2E Jira Project')).toBeVisible()

  // The token is stored encrypted and never sent back in full.
  const settings = await request.get('/api/settings/jira', { headers: authHeaders('super_admin') })
  expect(await settings.text()).not.toContain('e2e-jira-token-1234')
})

test('Confluence settings: save a token and test the connection', async ({ page }) => {
  // Another user than the Jira test: both rewrite the user's settings and run in parallel.
  await login(page, 'automation_lead')
  await openConnectionSettings(page, 'confluence')

  await page.getByLabel('Confluence Token').fill('e2e-confluence-token-5678')
  await page.getByLabel('Confluence Base URL').fill(`${fakeServicesUrl()}/confluence`)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('•••• 5678')).toBeVisible()

  await page.getByRole('button', { name: 'Test Connection' }).click()
  await expect(page.getByText('Authenticated as E2E Confluence User.')).toBeVisible()
})
