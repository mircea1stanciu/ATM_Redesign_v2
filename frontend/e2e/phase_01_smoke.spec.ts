import { expect, test } from '@playwright/test'
import { credentials, login } from './helpers'

// Smoke tests for today's main screens: the safety net for the redesign phases.

test.beforeEach(({ page }) => {
  page.on('pageerror', error => {
    throw new Error(`Uncaught error in the page: ${error.message}`)
  })
})

test.describe('login', () => {
  test('signs in with username and password', async ({ page }) => {
    const { username, password } = credentials('automation_user')
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)

    await page.getByLabel('Username or email').fill(username)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  })

  test('rejects a wrong password', async ({ page }) => {
    const { username } = credentials('automation_user')
    await page.goto('/login')

    await page.getByLabel('Username or email').fill(username)
    await page.getByLabel('Password').fill('not-the-password')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByText('Invalid credentials')).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)
  })
})

test.describe('main screens', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'super_admin')
  })

  test('Reports shows the dashboard', async ({ page }) => {
    await page.goto('/reports/overview')
    await expect(page.getByRole('heading', { name: 'Pass Rate Trend' })).toBeVisible()
    // Other UI tests may have run tests already: only the heading's shape is checked.
    await expect(page.getByRole('heading', { name: /^Recent Runs \(\d+\)$/ })).toBeVisible()
  })

  test('the side bar opens every area', async ({ page }) => {
    const areas = [
      { link: 'Work', url: /\/work\/inbox$/ },
      { link: 'Tests', url: /\/tests\/runs$/ },
      { link: 'Reports', url: /\/reports\/list$/ },
      { link: 'Reviews', url: /\/reviews$/ },
      { link: 'Deploys', url: /\/deployments\/timeline$/ },
      { link: 'Learning', url: /\/learning$/ },
      { link: 'Admin', url: /\/admin\/users$/ },
      { link: 'Settings', url: /\/settings$/ },
      { link: 'Home', url: /\/$/ },
    ]
    const nav = page.getByRole('navigation', { name: 'Main' })
    for (const area of areas) {
      await nav.getByRole('link', { name: area.link, exact: true }).click()
      await expect(page).toHaveURL(area.url)
    }
  })

  test('Tests › Project shows the selected project', async ({ page }) => {
    await page.goto('/tests/project')
    await expect(page.getByRole('heading', { name: 'E2E Sample Project' })).toBeVisible()
    await page.goto('/admin/projects')
    await expect(page.getByRole('button', { name: 'New project' })).toBeVisible()
  })

  test('Test Runs lists runs and run sources', async ({ page }) => {
    await page.goto('/tests/runs')
    await expect(page.getByRole('heading', { name: /^Project Runs \(\d+ of \d+\)$/ })).toBeVisible()
    for (const source of ['Local', 'GitHub Action', 'Devices']) {
      await expect(page.getByRole('button', { name: source, exact: true })).toBeVisible()
    }
  })

  test('the workspace opens with the AI assistant', async ({ page }) => {
    await page.goto('/work/workspace')
    // The sample project's checkout is linked (seed), so the workspace opens; no AI provider is connected.
    await expect(page.getByText('README.md', { exact: true })).toBeVisible()
    await expect(page.getByText('Connect an AI provider first')).toBeVisible()
  })

  test('Settings shows the profile and the connections', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
    // Each section link is named by its title followed by a short description.
    const sections = ['My Profile Password', 'Jira Token', 'Confluence Token', 'Project GitHub Per-project', 'AI Assistant GitHub']
    for (const section of sections) {
      await expect(page.getByRole('link', { name: new RegExp(`^${section}`) })).toBeVisible()
    }
  })
})

test.describe('roles', () => {
  test('a user without user-management rights does not see Admin', async ({ page }) => {
    await login(page, 'automation_user')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect(nav.getByRole('link', { name: 'Tests', exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0)

    await page.goto('/admin/users')
    await expect(page).toHaveURL(/\/$/)
  })
})
