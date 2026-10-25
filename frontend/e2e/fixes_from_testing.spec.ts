import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { authHeaders, login } from './helpers'

// Fixes for issues found while testing the app after phase 22 (branch feature/fixes_from_testing).

test.beforeEach(({ page }) => {
  page.on('pageerror', error => {
    throw new Error(`Uncaught error in the page: ${error.message}`)
  })
})

test('a switch that is on keeps its thumb inside the track, on the right', async ({ page }) => {
  await login(page, 'secrets_tester') // an Automation User: tutor mode is on by default
  await page.goto('/learning/paths')
  const toggle = page.getByRole('switch', { name: 'AI tutor mode' })
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await page.waitForTimeout(300) // the slide animation
  const { track, thumb } = await toggle.evaluate(el => {
    const t = el.getBoundingClientRect()
    const k = el.firstElementChild!.getBoundingClientRect()
    return { track: { left: t.left, right: t.right }, thumb: { left: k.left, right: k.right } }
  })
  expect(thumb.right).toBeLessThanOrEqual(track.right) // it used to stick out past the right end
  expect(thumb.left).toBeGreaterThan((track.left + track.right) / 2 - 1) // and sits in the right half
})

test('the GitHub settings say which rights the token needs', async ({ page }) => {
  await login(page, 'automation_user')
  await page.goto('/settings/mcp/github')
  const rights = page.getByRole('table', { name: 'GitHub token permissions' })
  for (const [permission, access] of [['Contents', 'Read and write'], ['Pull requests', 'Read and write'],
    ['Actions', 'Read and write'], ['Metadata', 'Read-only']]) {
    await expect(rights.getByRole('row', { name: new RegExp(`^${permission} ${access}`) })).toBeVisible()
  }
  await expect(page.getByRole('link', { name: 'create one' }))
    .toHaveAttribute('href', 'https://github.com/settings/personal-access-tokens/new')
})

test('without a local copy, the workspace leads to the Repository view, where one is cloned', async ({ page, request }) => {
  // The lead has no checkout of the sample project; give them a GitHub token for the clone, and take it back after.
  const lead = authHeaders('automation_lead')
  const projects = await (await request.get('/api/projects/', { headers: lead })).json()
  const projectId = projects.find((p: { name: string }) => p.name === 'E2E Sample Project').id
  expect((await request.patch(`/api/projects/${projectId}/github`, { headers: lead, data: { github_token: 'e2e-github-token' } })).ok()).toBeTruthy()
  try {
    await login(page, 'automation_lead')
    await page.goto('/work/workspace')
    await expect(page.getByText('No local copy of the repository yet')).toBeVisible()
    // It used to send you to Tests › Project, whose link sent you back here.
    await page.getByRole('button', { name: 'Clone or link the repository' }).click()
    await expect(page).toHaveURL(/view=three-panel/)
    await expect(page.getByText('No local copy of the repository yet')).toHaveCount(0)

    await page.getByRole('button', { name: /Import new project/ }).click()
    await page.getByPlaceholder('/absolute/path/to/folder').fill(join(mkdtempSync(join(tmpdir(), 'atm-e2e-clone-')), 'sample'))
    await page.getByRole('button', { name: 'Clone here' }).click()
    await expect(page.getByRole('button', { name: /^Remove/ })).toBeVisible({ timeout: 60_000 })
    // The rest of the workspace opens without a reload.
    await page.getByRole('tab', { name: 'Editor' }).click()
    await expect(page.getByText('No local copy of the repository yet')).toHaveCount(0)
    await expect(page.getByRole('toolbar', { name: 'Workspace actions' })).toBeVisible()

    // Removing the copy closes the workspace again (and leaves the lead without a checkout for the other specs).
    await page.getByRole('tab', { name: 'Repository' }).click()
    page.once('dialog', dialog => void dialog.accept())
    await page.getByRole('button', { name: /^Remove/ }).click()
    await page.getByRole('tab', { name: 'Editor' }).click()
    await expect(page.getByText('No local copy of the repository yet')).toBeVisible()
  } finally {
    await request.delete(`/api/projects/${projectId}/github`, { headers: lead })
  }
})
