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
    await expect(page.getByRole('heading', { name: /^Recent Runs/ })).toBeVisible()
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

  test('Home shows the dashboard', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Pass Rate Trend' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Recent Runs (0)' })).toBeVisible()
  })

  test('top navigation opens every area', async ({ page }) => {
    const areas = [
      { link: 'Projects', url: /\/projects$/ },
      { link: 'Jira and Confluence', url: /\/jira-confluence\/jira$/ },
      { link: 'Upskilling', url: /\/upskilling$/ },
      { link: 'Users', url: /\/users$/ },
      { link: 'Settings', url: /\/settings$/ },
      { link: 'Dashboard', url: /\/$/ },
    ]
    const nav = page.getByRole('navigation').first()
    for (const area of areas) {
      await nav.getByRole('link', { name: area.link, exact: true }).click()
      await expect(page).toHaveURL(area.url)
    }
  })

  test('Projects shows the selected project', async ({ page }) => {
    await page.goto('/projects')
    await expect(page.getByRole('heading', { name: 'E2E Sample Project' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New Project' })).toBeVisible()
  })

  test('Test Runs lists runs and run sources', async ({ page }) => {
    await page.goto('/projects/runs')
    await expect(page.getByRole('heading', { name: 'Project Runs (0 of 0)' })).toBeVisible()
    for (const source of ['Local', 'GitHub Action', 'Devices']) {
      await expect(page.getByRole('button', { name: source, exact: true })).toBeVisible()
    }
  })

  test('AI Assistant opens for the project', async ({ page }) => {
    await page.goto('/projects/ai')
    await page.getByRole('button', { name: 'AI Assistant' }).click()
    await expect(page).toHaveURL(/\/projects\/ai\?tab=assistant$/)
    // The sample project has no local copy yet, so the assistant explains how to link one.
    await expect(page.getByText("The assistant works on the project's local copy")).toBeVisible()
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
  test('a user without user-management rights does not see Users', async ({ page }) => {
    await login(page, 'automation_user')
    const nav = page.getByRole('navigation').first()
    await expect(nav.getByRole('link', { name: 'Projects', exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Users', exact: true })).toHaveCount(0)

    await page.goto('/users')
    await expect(page).toHaveURL(/\/$/)
  })
})
