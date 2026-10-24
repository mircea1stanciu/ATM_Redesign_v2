import { expect, test } from '@playwright/test'
import { authHeaders, login, type Role } from './helpers'

// Phase 04: the six roles and the two scope tags, enforced by the backend and reflected in the UI
// (docs/redesign/04-roles-and-permissions.md).

test.beforeEach(({ page }) => {
  page.on('pageerror', error => {
    throw new Error(`Uncaught error in the page: ${error.message}`)
  })
  page.on('dialog', dialog => void dialog.accept())
})

const ROLES: Array<{ role: Role; label: string; seesUsers: boolean; managesUsers: boolean; createsProjects: boolean }> = [
  { role: 'super_admin', label: 'Super Admin', seesUsers: true, managesUsers: true, createsProjects: true },
  { role: 'automation_lead', label: 'Automation Lead', seesUsers: true, managesUsers: true, createsProjects: true },
  { role: 'automation_senior', label: 'Automation Senior', seesUsers: true, managesUsers: false, createsProjects: false },
  { role: 'automation_user', label: 'Automation User', seesUsers: false, managesUsers: false, createsProjects: false },
  { role: 'automation_trainee', label: 'Automation Trainee', seesUsers: false, managesUsers: false, createsProjects: false },
  { role: 'viewer', label: 'Viewer', seesUsers: false, managesUsers: false, createsProjects: false },
]

for (const { role, label, seesUsers, managesUsers, createsProjects } of ROLES) {
  test(`${label}: navigation and actions`, async ({ page }) => {
    await login(page, role)
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect(nav.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(seesUsers ? 1 : 0)
    await page.getByRole('button', { name: 'Account menu' }).click()
    // The account menu shows the role, and the scope tag for seniors, users and trainees.
    await expect(page.getByRole('menu').getByText(new RegExp(`^${label}( · (Shared|Project based))?$`))).toBeVisible()

    await page.keyboard.press('Escape')
    // Every seeded role sees the sample project: lead of it, shared, or a member.
    await expect(page.getByRole('button', { name: 'Switch project (current: E2E Sample Project)' })).toBeVisible()

    await page.goto('/admin/projects')
    if (createsProjects) await expect(page.getByRole('button', { name: 'New project' })).toBeVisible()
    else await expect(page).not.toHaveURL(/\/admin\/projects/)

    await page.goto('/admin/users')
    if (!seesUsers) {
      await expect(page).toHaveURL(/\/$/)
      return
    }
    await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible()
    await expect(page.getByText('e2e_viewer@e2e.test')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add User' })).toHaveCount(managesUsers ? 1 : 0)
    if (!managesUsers) await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(0)
  })
}

test('a Lead changes a User into a Senior', async ({ page, request }) => {
  // A lead's new people are assigned to that lead.
  const name = `E2E Promoted ${Date.now()}`
  const created = await request.post('/api/users', {
    headers: authHeaders('automation_lead'),
    data: { email: `promoted-${Date.now()}@example.com`, password: 'promote-me-123', full_name: name, role: 'automation_user' },
  })
  expect(created.status()).toBe(201)
  const user = await created.json()

  await login(page, 'automation_lead')
  await page.goto('/admin/users')
  // Leads may change their own people only; the super admin is not theirs.
  await expect(page.getByRole('button', { name: 'Edit E2E Super Admin' })).toHaveCount(0)
  await page.getByRole('button', { name: `Edit ${name}` }).click()
  const dialog = page.locator('form, .fixed').filter({ hasText: 'Edit User' }).last()
  // Leads offer roles up to Senior.
  await expect(dialog.getByRole('radio', { name: 'Automation Lead' })).toHaveCount(0)
  await dialog.getByRole('radio', { name: 'Automation Senior' }).check()
  await dialog.getByRole('radio', { name: 'Shared' }).check()
  await dialog.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Edit User')).toHaveCount(0)

  const users: Array<{ id: string; role: string; scope_tag: string }> = await (
    await request.get('/api/users', { headers: authHeaders('super_admin') })
  ).json()
  expect(users.find(u => u.id === user.id)).toMatchObject({ role: 'automation_senior', scope_tag: 'shared' })
})

test('the backend refuses what the role may not do', async ({ request }) => {
  const forbidden = await request.post('/api/projects/', { headers: authHeaders('automation_user'), data: { name: 'Nope' } })
  expect(forbidden.status()).toBe(403)
  expect(await forbidden.json()).toMatchObject({ code: 'permission_denied' })

  const promote = await request.post('/api/users', {
    headers: authHeaders('automation_lead'),
    data: { email: `lead-${Date.now()}@example.com`, password: 'not-a-lead-123', full_name: 'Not a lead', role: 'automation_lead' },
  })
  expect(promote.status()).toBe(403)

  const me = await (await request.get('/api/me', { headers: authHeaders('viewer') })).json()
  expect(me).toMatchObject({ role: 'viewer', scope_tag: null, all_projects: false })
  expect(me.permissions).toContain('report.view')
  expect(me.permissions).not.toContain('code.edit')
})
