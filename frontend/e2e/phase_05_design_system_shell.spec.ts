import { expect, test } from '@playwright/test'
import { login, type Role } from './helpers'

// Phase 05: the new shell (side bar, top bar, project switcher, command palette, notification bell), the seven
// areas with URL-driven tabs, the theme and the keyboard shortcuts (docs/redesign/05-design.md).

test.beforeEach(({ page }) => {
  page.on('pageerror', error => {
    throw new Error(`Uncaught error in the page: ${error.message}`)
  })
})

const EVERYONE = ['Home', 'Work', 'Tests', 'Reports', 'Reviews', 'Deploys', 'Learning']

const NAVIGATION: Record<Role, string[]> = {
  super_admin: [...EVERYONE, 'Admin', 'Settings'],
  automation_lead: [...EVERYONE, 'Admin', 'Settings'],
  automation_senior: [...EVERYONE, 'Admin', 'Settings'],
  automation_user: [...EVERYONE, 'Settings'],
  automation_trainee: [...EVERYONE, 'Settings'],
  viewer: [...EVERYONE, 'Settings'],
}

const HOME_SECTIONS: Record<Role, string> = {
  super_admin: 'System health',
  automation_lead: 'My team',
  automation_senior: 'Waiting for my review',
  automation_user: 'My work items',
  automation_trainee: 'My learning path',
  viewer: 'Latest results',
}

for (const [role, links] of Object.entries(NAVIGATION) as Array<[Role, string[]]>) {
  test(`${role}: side bar and Home`, async ({ page }) => {
    await login(page, role)
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect(nav.getByRole('link')).toHaveText(links)
    await expect(page.getByRole('heading', { name: HOME_SECTIONS[role] })).toBeVisible()
  })
}

test('every area and tab loads', async ({ page }) => {
  await login(page, 'super_admin')
  const screens: Array<[string, string]> = [
    ['/work/inbox', 'Work'], ['/work/board', 'Work'], ['/work/jira', 'Work'], ['/work/confluence', 'Work'], ['/work/confluence-analyzer', 'Work'],
    ['/work/workspace', 'Work'], ['/work/repository', 'Work'],
    ['/tests/runs', 'Tests'], ['/tests/project', 'Tests'], ['/tests/libraries', 'Tests'],
    ['/reports/overview', 'Reports'], ['/reports/analytics', 'Reports'],
    ['/reviews', 'Reviews'], ['/deployments', 'Deploys'],
    ['/admin/users', 'Admin'], ['/admin/projects', 'Admin'],
  ]
  for (const [url, title] of screens) {
    await page.goto(url)
    await expect(page.getByRole('heading', { level: 1, name: title, exact: true }), url).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`${url}$`))
  }
  await page.goto('/learning')
  await expect(page).toHaveURL(/\/learning$/)
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()

  // Area tabs are links to URLs.
  await page.goto('/tests/runs')
  await page.getByRole('navigation', { name: 'Tests sections' }).getByRole('link', { name: 'Libraries' }).click()
  await expect(page).toHaveURL(/\/tests\/libraries$/)
})

test('old URLs redirect to the new ones', async ({ page }) => {
  await login(page, 'super_admin')
  const moved: Array<[string, RegExp]> = [
    ['/projects', /\/tests\/project$/],
    ['/projects/repository', /\/work\/repository$/],
    ['/projects/ai?tab=assistant', /\/work\/workspace\?tab=assistant$/],
    ['/projects/runs', /\/tests\/runs$/],
    ['/projects/library', /\/tests\/libraries$/],
    ['/projects/analytics', /\/reports\/analytics$/],
    ['/jira-confluence/jira', /\/work\/jira$/],
    ['/jira-confluence/confluence/configuration', /\/work\/confluence$/],
    ['/jira-confluence/confluence/analyzer', /\/work\/confluence-analyzer$/],
    ['/upskilling', /\/learning$/],
    ['/users', /\/admin\/users$/],
    ['/runs', /\/tests\/runs$/],
    ['/analytics', /\/reports\/analytics$/],
  ]
  for (const [from, to] of moved) {
    await page.goto(from)
    await expect(page, from).toHaveURL(to)
  }
})

test('sub-tabs are in the URL', async ({ page }) => {
  await login(page, 'super_admin')
  await page.goto('/work/repository?view=publish')
  await expect(page.getByText('2 · Commit your changes')).toBeVisible()
  await page.reload()
  await expect(page).toHaveURL(/view=publish/)
})

test('command palette jumps to areas, tabs and actions', async ({ page }) => {
  await login(page, 'super_admin')
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  await palette.getByRole('combobox').fill('Release analyzer')
  // cmdk moves the selection to the first match one render after filtering.
  await expect(palette.getByRole('option', { name: 'Work › Release analyzer' })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/work\/confluence-analyzer$/)
  await expect(palette).toBeHidden()

  await page.getByRole('button', { name: 'Open command palette' }).first().click()
  await palette.getByRole('combobox').fill('keyboard shortcuts')
  await expect(palette.getByRole('option', { name: /Keyboard shortcuts/ })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
})

test('a viewer\'s palette offers only what they can open', async ({ page }) => {
  await login(page, 'viewer')
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await palette.getByRole('combobox').fill('Admin')
  await expect(palette.getByRole('option', { name: /Admin/ })).toHaveCount(0)
  await palette.getByRole('combobox').fill('New project')
  await expect(palette.getByRole('option', { name: 'New project' })).toHaveCount(0)
})

test('keyboard: g + letter jumps to an area, ? lists the shortcuts, Tab reaches the skip link', async ({ page }) => {
  await login(page, 'automation_user')
  // Shortcuts open only areas the user may see, so wait until /api/me has loaded.
  await expect(page.getByText('Automation User · E2E Sample Project')).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

  await page.keyboard.press('g')
  await page.keyboard.press('t')
  await expect(page).toHaveURL(/\/tests\/runs$/)
  await page.keyboard.press('g')
  await page.keyboard.press('r')
  await expect(page).toHaveURL(/\/reports\/overview$/)
  await page.keyboard.press('g')
  await page.keyboard.press('h')
  await expect(page).toHaveURL(/\/$/)

  await page.keyboard.press('?')
  const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(shortcuts).toContainText('Go to Learning')
  await page.keyboard.press('Escape')
  await expect(shortcuts).toBeHidden()
})

test('theme switch applies and is remembered', async ({ page }) => {
  await login(page, 'automation_user')
  const html = page.locator('html')
  const wasDark = (await html.getAttribute('class'))?.includes('dark') ?? false
  await page.getByRole('button', { name: 'Toggle theme' }).click()
  await expect(html).toHaveClass(wasDark ? /^(?!.*dark)/ : /dark/)
  await page.reload()
  await expect(html).toHaveClass(wasDark ? /^(?!.*dark)/ : /dark/)
  await page.getByRole('button', { name: 'Toggle theme' }).click()
  await expect(html).toHaveClass(wasDark ? /dark/ : /^(?!.*dark)/)
})

test('side bar collapses to icons and remembers it', async ({ page }) => {
  await login(page, 'automation_trainee')
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
  // Collapsed links keep their names for screen readers.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Learning' }).click()
  await expect(page).toHaveURL(/\/learning$/)
  await page.getByRole('button', { name: 'Expand sidebar' }).click()
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible()
})

test('project switcher searches projects; the bell opens the notification panel', async ({ page }) => {
  await login(page, 'automation_lead')
  await page.getByRole('button', { name: /^Switch project/ }).click()
  await page.getByPlaceholder('Search projects…').fill('nothing like this')
  await expect(page.getByText('No project found.')).toBeVisible()
  await page.getByPlaceholder('Search projects…').fill('Sample')
  await page.getByRole('option', { name: /E2E Sample Project/ }).click()
  await expect(page.getByRole('button', { name: 'Switch project (current: E2E Sample Project)' })).toBeVisible()
  await page.getByRole('button', { name: /^Switch project/ }).click()
  await expect(page.getByText('Recent', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Notifications' }).click()
  await expect(page.getByText('No notifications yet')).toBeVisible()
})
