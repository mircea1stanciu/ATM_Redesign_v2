import { expect, test, type APIRequestContext } from '@playwright/test'
import { authHeaders, login } from './helpers'

// Phase 21 (from the decisions review): Community is back (ask and answer); a lead builds a learning path that a
// trainee follows; a lead assigns a Senior mentor who then reviews that trainee's practice; tutor mode is on by
// default for Users too. The "mentee" trainee is seeded for this spec, so other specs keep their paths and mentors.

test.describe.configure({ mode: 'serial', timeout: 120_000 })

test.beforeEach(({ page }) => {
  page.on('pageerror', error => {
    throw new Error(`Uncaught error in the page: ${error.message}`)
  })
})

const SUFFIX = Date.now().toString(36)
const QUESTION = `How do I wait for a toast that disappears? ${SUFFIX}`
const ANSWER = `Assert it with toBeVisible() right after the click ${SUFFIX}`
const PATH = `Python and Robot Framework ${SUFFIX}`
const TASK = `Keyword for the login ${SUFFIX}`

async function notificationTitles(request: APIRequestContext, person: 'automation_trainee' | 'automation_senior' | 'mentee') {
  const { items } = await (await request.get('/api/notifications', { headers: authHeaders(person) })).json()
  return items.map((n: { title: string }) => n.title)
}

test('a trainee asks in Community; a senior answers; the trainee is told and likes the answer', async ({ page, request }) => {
  await login(page, 'automation_trainee')
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Community', exact: true }).click()
  await page.getByRole('button', { name: 'Ask a question' }).click()
  const dialog = page.getByRole('dialog', { name: 'Ask a question' })
  await dialog.getByLabel('Question').fill(QUESTION)
  await dialog.getByLabel('Details (Markdown)').fill('The toast is gone before `expect` runs.')
  await dialog.getByLabel('Tags (optional)').fill('playwright, waits')
  await dialog.getByRole('button', { name: 'Post question' }).click()
  await expect(page).toHaveURL(/\/community\/\d+$/)
  await expect(page.getByRole('heading', { level: 1, name: QUESTION })).toBeVisible()
  const questionUrl = new URL(page.url()).pathname

  await login(page, 'automation_senior')
  await page.goto('/community')
  await page.getByLabel('Search questions').fill(SUFFIX)
  await page.getByRole('list', { name: 'Questions' }).getByRole('link', { name: QUESTION }).click()
  await page.getByLabel('Your answer (Markdown)').fill(ANSWER)
  await page.getByRole('button', { name: 'Post answer' }).click()
  await expect(page.getByRole('region', { name: 'Answers' })).toContainText(ANSWER)
  await expect(page.getByLabel('Your answer (Markdown)')).toHaveValue('')

  await expect.poll(() => notificationTitles(request, 'automation_trainee'))
    .toContain(`E2E Automation Senior answered your question: ${QUESTION}`)
  await login(page, 'automation_trainee')
  await page.goto(questionUrl)
  const like = page.getByRole('button', { name: /^Like the answer of E2E Automation Senior/ })
  await like.click()
  await expect(like).toHaveAttribute('aria-pressed', 'true')
  await expect(like).toHaveAccessibleName('Like the answer of E2E Automation Senior (1)')
})

test('a lead builds a learning path; the trainee makes it theirs; the lead deletes it', async ({ page, request }) => {
  await login(page, 'automation_lead')
  await page.goto('/learning/paths')
  await page.getByRole('button', { name: 'New path' }).click()
  const dialog = page.getByRole('dialog', { name: 'New learning path' })
  await dialog.getByLabel('Path title').fill(PATH)
  await dialog.getByLabel('Description').fill('pytest first, then keyword-driven suites.')
  await dialog.getByLabel('Add a program').selectOption({ label: 'Robot Framework' })
  await dialog.getByLabel('Add a program').selectOption({ label: 'Python' })
  await dialog.getByRole('button', { name: 'Move Python up' }).click() // the language before the framework
  await expect(dialog.getByRole('list', { name: 'Programs of the path' }).getByRole('listitem')).toHaveText([/Python/, /Robot Framework/])
  await dialog.getByRole('button', { name: 'Save path' }).click()
  await expect(dialog).toBeHidden()

  const card = page.getByRole('list', { name: 'Learning paths' }).getByRole('listitem').filter({ hasText: PATH })
  await expect(card).toContainText('Python → Robot Framework')
  await card.getByRole('button', { name: `Move ${PATH} up` }).click()
  const order = async () => (await (await request.get('/api/learning/paths', { headers: authHeaders('automation_lead') })).json())
    .map((p: { title: string }) => p.title)
  await expect.poll(async () => { const titles = await order(); return titles.indexOf(PATH) === titles.length - 2 }).toBe(true)

  await login(page, 'mentee')
  await page.goto('/learning/paths')
  await page.getByRole('link', { name: PATH }).click()
  await expect(page.getByRole('heading', { name: PATH })).toBeVisible()
  await page.getByRole('button', { name: 'Make this my path' }).click()
  await expect(page.getByText('My path', { exact: true })).toBeVisible()

  await login(page, 'automation_lead')
  await page.goto('/learning/paths')
  await card.getByRole('button', { name: `Delete ${PATH}` }).click()
  const confirm = page.getByRole('dialog', { name: `Delete ${PATH}?` })
  await confirm.getByRole('button', { name: 'Delete path' }).click()
  await expect(confirm).toBeHidden() // while it is open the list is hidden from the accessibility tree
  await expect(card).toHaveCount(0)
  await expect.poll(async () => (await (await request.get('/api/learning/me', { headers: authHeaders('mentee') })).json())
    .profile.path_id).toBeNull() // they choose another path
})

test('a lead assigns a Senior mentor, who then reviews that trainee\'s practice', async ({ page, request }) => {
  await login(page, 'automation_lead')
  await page.goto('/learning/mentor')
  await page.getByRole('table', { name: 'Mentors' }).getByLabel('Mentor of E2E Mentee').selectOption({ label: 'E2E Automation Senior' })
  await expect(page.getByText('E2E Automation Senior mentors them now')).toBeVisible()
  await expect.poll(() => notificationTitles(request, 'automation_senior')).toContain('You now mentor E2E Mentee')

  // The lead writes a practice task; the mentee hands it in.
  const task = await (await request.post('/api/learning/practice', {
    headers: authHeaders('automation_lead'), data: { title: TASK, description: 'Write a Robot keyword that signs in.', active: true },
  })).json()
  expect((await request.post(`/api/learning/practice/${task.id}/submit`, {
    headers: authHeaders('mentee'), data: { branch: `practice/mentee-${SUFFIX}`, note: 'My first keyword' },
  })).ok()).toBeTruthy()

  await login(page, 'automation_senior')
  await page.goto('/learning/mentor')
  await expect(page.getByRole('table', { name: 'Mentees' })).toContainText('E2E Mentee')
  await expect(page.getByRole('table', { name: 'Mentees' })).not.toContainText('E2E Automation Trainee') // not assigned
  const waiting = page.getByRole('list', { name: 'Practice waiting for review' }).getByRole('listitem').filter({ hasText: TASK })
  await waiting.getByLabel('Feedback for E2E Mentee').fill('Clear keyword, well done.')
  await waiting.getByRole('button', { name: 'Approve' }).click()
  await expect(waiting).toHaveCount(0)
  const practice = await (await request.get('/api/learning/practice', { headers: authHeaders('mentee') })).json()
  expect(practice.find((t: { id: number }) => t.id === task.id).my_submission).toMatchObject({ status: 'approved', reviewer: 'E2E Automation Senior' })
})

test('tutor mode is on by default for a User too', async ({ page }) => {
  await login(page, 'secrets_tester') // an Automation User who never changed it
  await page.goto('/learning/paths')
  await expect(page.getByRole('switch', { name: 'AI tutor mode' })).toHaveAttribute('aria-checked', 'true')
})
