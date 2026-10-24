import { expect, test, type APIRequestContext } from '@playwright/test'
import { authHeaders, fakeServicesUrl, login } from './helpers'

// Phase 12: review pull requests in ATM against the fake GitHub (e2e/harness/fake-services.mjs). A pull request
// opened on GitHub asks the senior (GitHub user e2e-senior) for a review; the senior comments on a line, adds an AI
// suggestion and approves; an automation user may only comment; a viewer only reads.

test.describe.configure({ mode: 'serial', timeout: 120_000 })

test.beforeEach(({ page }) => {
  page.on('pageerror', error => {
    throw new Error(`Uncaught error in the page: ${error.message}`)
  })
})

const SUFFIX = Date.now().toString(36)
const TITLE = `Login error test checks the text ${SUFFIX}`
const FILE = 'tests/test_login_error.py'
let prPath = ''

type ReviewWrite = { number: number; login: string; event: string; body: string; comments: Array<{ path: string; line: number; side: string; body: string }> }

async function reviewWrites(request: APIRequestContext): Promise<ReviewWrite[]> {
  return (await (await request.get(`${fakeServicesUrl()}/__e2e/requests`)).json()).reviewWrites
}

test('a pull request on GitHub asks the senior for a review', async ({ request }) => {
  const opened = await request.post(`${fakeServicesUrl()}/__e2e/pull-request`, {
    data: {
      branch: `review/login-${SUFFIX}`, path: FILE, title: TITLE, author: 'e2e-user', requested: ['e2e-senior'],
      body: 'The test now asserts the message.',
      content: "def test_login_error_message():\n    message = 'Wrong email or password'\n    assert message == 'Wrong email or password'\n    assert len(message) > 5\n",
    },
  })
  expect(opened.ok()).toBeTruthy()
  const projects = await (await request.get('/api/projects/', { headers: authHeaders('automation_senior') })).json()
  const projectId = projects.find((p: { name: string }) => p.name === 'E2E Sample Project').id
  prPath = `/reviews/${projectId}/${(await opened.json()).number}`
  // The senior's AI assistant is the fake GitHub Models provider.
  expect((await request.put('/api/ai/settings', {
    headers: authHeaders('automation_senior'), data: { provider: 'github', api_key: 'e2e-ai-key', model: 'openai/gpt-4.1' },
  })).ok()).toBeTruthy()
})

test('the senior comments on a line, adds an AI suggestion and approves', async ({ page, request }) => {
  await login(page, 'automation_senior')
  await page.goto('/reviews')
  await expect(page).toHaveURL(/\/reviews\/waiting$/)
  const item = page.getByRole('list', { name: 'Pull requests' }).getByRole('listitem').filter({ hasText: TITLE })
  await expect(item).toContainText('Waiting for you')
  await item.getByRole('link', { name: TITLE }).click()
  await expect(page).toHaveURL(new RegExp(`${prPath}$`))
  await expect(page.getByRole('heading', { name: new RegExp(TITLE) })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Checks' })).toContainText('unit tests')

  const diff = page.getByRole('table', { name: `Diff of ${FILE}` })
  await expect(diff).toContainText("assert message == 'Wrong email or password'")
  await diff.getByRole('button', { name: `Comment on line 3 of ${FILE}` }).click()
  await page.getByRole('textbox', { name: `Comment on line 3 of ${FILE}` }).fill('Good: this checks the exact message.')
  await page.getByRole('button', { name: 'Add to review' }).click()
  await expect(diff).toContainText('Pending')

  await page.getByRole('button', { name: 'Ask AI to review' }).click()
  const suggestions = page.getByRole('list', { name: 'AI suggestions' })
  await expect(suggestions.getByRole('listitem')).toHaveCount(1) // the one outside the diff is dropped
  await expect(suggestions).toContainText(`${FILE}:4`)
  await page.getByRole('button', { name: 'Add 1 to my review' }).click()
  await expect(page.getByText('2 pending line comments')).toBeVisible()

  await page.getByLabel('Review summary').fill('Looks good, thank you.')
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('0 pending line comments')).toBeVisible()

  const sent = (await reviewWrites(request)).find(w => w.login === 'e2e-senior' && w.event === 'APPROVE')!
  expect(sent.body).toBe('Looks good, thank you.')
  expect(sent.comments).toEqual([
    { path: FILE, line: 3, side: 'RIGHT', body: 'Good: this checks the exact message.' },
    { path: FILE, line: 4, side: 'RIGHT', body: 'Compare with the exact text the page shows instead of the length.' },
  ])
  // Back from GitHub: the comments under their lines, the approval in the conversation.
  await expect(diff).toContainText('Good: this checks the exact message.')
  await page.getByRole('tab', { name: /Conversation/ }).click()
  await expect(page.getByRole('list', { name: 'Conversation' })).toContainText('approved')
  await page.goto('/reviews/waiting')
  await expect(page.getByRole('list', { name: 'Pull requests' }).getByText(TITLE)).toHaveCount(0)
})

test('an automation user comments but cannot approve', async ({ page, request }) => {
  await login(page, 'automation_user')
  await page.goto('/reviews/open')
  await page.getByRole('link', { name: TITLE }).click()
  await expect(page.getByRole('button', { name: 'Comment', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Request changes' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Ask AI to review' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Inline' }).click()
  const diff = page.getByRole('table', { name: `Diff of ${FILE}` })
  await diff.getByRole('button', { name: `Comment on line 1 of ${FILE}` }).click()
  await page.getByRole('textbox', { name: `Comment on line 1 of ${FILE}` }).fill('Could the name say which page?')
  await page.getByRole('button', { name: 'Add to review' }).click()
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect.poll(async () => (await reviewWrites(request)).find(w => w.login === 'e2e-bot' && w.event === 'COMMENT')?.comments)
    .toEqual([{ path: FILE, line: 1, side: 'RIGHT', body: 'Could the name say which page?' }])
  await page.getByRole('button', { name: 'Side by side' }).click() // leave the shared default as it was
})

test('a viewer reads the pull request without review controls', async ({ page }) => {
  await login(page, 'viewer')
  await page.goto(prPath)
  await expect(page.getByRole('table', { name: `Diff of ${FILE}` })).toContainText('Good: this checks the exact message.')
  await expect(page.getByLabel('Review summary')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Comment on line/ })).toHaveCount(0)
})
