import { expect, test } from '@playwright/test'
import { login } from './helpers'

// Phase 16 (from the decisions review): the inbox lists every issue type by default, filters by real Jira sprints and
// by an advanced JQL clause, and filters are saved to the user's account (one opens the inbox); the workspace tab is
// called Repository and the action bar shows the project's last run.

test.describe.configure({ mode: 'serial', timeout: 60_000 })

test.beforeEach(({ page }) => {
  page.on('pageerror', error => {
    throw new Error(`Uncaught error in the page: ${error.message}`)
  })
})

const FILTER = `Only E2E-2 ${Date.now().toString(36)}`

test('every issue type by default; stories and a sprint from Jira narrow it', async ({ page }) => {
  await login(page, 'automation_user')
  await page.goto('/work/inbox')
  const list = page.getByRole('list', { name: 'Jira stories' })
  await expect(list.getByRole('button', { name: /E2E-3/ })).toBeVisible() // a bug: shown now
  await page.getByLabel('Type').selectOption('stories')
  await expect(list.getByRole('button', { name: /E2E-3/ })).toHaveCount(0)
  await page.getByLabel('Type').selectOption('')

  const sprint = page.getByLabel('Sprint')
  await expect(sprint.locator('optgroup[label="Active"] option')).toHaveText(['E2E Sprint 12'])
  await expect(sprint.locator('optgroup[label="Closed"] option')).toHaveText(['E2E Sprint 11'])
  await sprint.selectOption({ label: 'E2E Sprint 12' })
  await expect(page).toHaveURL(/sprint=12/)
  await expect(list.getByRole('button')).toHaveCount(1)
  await expect(list.getByRole('button', { name: /E2E-1/ })).toBeVisible()
  await sprint.selectOption('')
})

test('an advanced JQL filter is saved as the default and opens the inbox', async ({ page }) => {
  await login(page, 'automation_user')
  await page.goto('/work/inbox')
  const list = page.getByRole('list', { name: 'Jira stories' })
  await page.getByRole('button', { name: 'More filters' }).click()
  const dialog = page.getByRole('dialog', { name: 'More filters' })
  await dialog.getByLabel('Advanced JQL (optional)').fill('key in (E2E-2)')
  await dialog.getByRole('button', { name: 'Apply' }).click()
  await expect(list.getByRole('button')).toHaveCount(1)
  await expect(list.getByRole('button', { name: /E2E-2/ })).toBeVisible()

  await page.getByRole('button', { name: 'Save these filters' }).click()
  const save = page.getByRole('dialog', { name: 'Save these filters' })
  await save.getByLabel('Name').fill(FILTER)
  await save.getByRole('checkbox', { name: 'Open the inbox with this filter' }).check()
  await save.getByRole('button', { name: 'Save' }).click()
  await expect(save).toBeHidden()
  await expect(page.getByLabel('Saved filters')).toHaveValue(/\d+/)

  // Saved on the account: a fresh inbox (no filters in the URL) opens with it.
  await page.goto('/work/inbox')
  await expect(page).toHaveURL(/jql=/)
  await expect(list.getByRole('button')).toHaveCount(1)
  await expect(page.getByLabel('Saved filters').locator('option:checked')).toHaveText(`${FILTER} (default)`)
  await page.getByRole('button', { name: `Delete the saved filter ${FILTER}` }).click()
  await expect(page.getByLabel('Saved filters').locator('option')).toHaveCount(1)
})

test('the workspace tab is called Repository', async ({ page }) => {
  await login(page, 'automation_trainee')
  await page.goto('/work/workspace')
  await expect(page.getByRole('tab', { name: 'Repository' })).toBeVisible()
  await expect(page.getByRole('tab', { name: '3-Panel' })).toHaveCount(0)
})
