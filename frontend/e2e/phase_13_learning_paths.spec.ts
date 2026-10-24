import { expect, test } from '@playwright/test'
import { MODULE_QUIZZES } from '../src/features/learning/content'
import { login } from './helpers'

// Phase 13: a trainee follows a learning path (progress saved on the server, quizzes shuffled), hands in practice,
// and the lead sees it all in the mentor view.

test.describe.configure({ mode: 'serial', timeout: 120_000 })

test.beforeEach(({ page }) => {
  page.on('pageerror', error => {
    throw new Error(`Uncaught error in the page: ${error.message}`)
  })
})

const PATH = 'Manual to API automation with Bruno'
const LESSON = 'Why Bruno & Installation'
const MODULE = 'Getting Started with Bruno'
const TASK = `Assert the login message ${Date.now().toString(36)}`

test('a trainee completes a lesson and a quiz; the progress survives a reload', async ({ page }) => {
  await login(page, 'automation_trainee')
  await page.goto('/learning')
  await expect(page).toHaveURL(/\/learning\/paths$/)
  await page.getByRole('link', { name: PATH }).click()
  await expect(page.getByRole('heading', { name: PATH })).toBeVisible()
  const makeMine = page.getByRole('button', { name: 'Make this my path' })
  if (await makeMine.isVisible()) await makeMine.click()
  await expect(page.getByText('My path', { exact: true })).toBeVisible()

  // The lesson: step through it and finish.
  const lessons = page.getByRole('list', { name: MODULE })
  await lessons.getByRole('link', { name: LESSON }).click()
  await expect(page.getByRole('heading', { name: LESSON })).toBeVisible()
  const finish = page.getByRole('button', { name: /Finish & (mark|keep) complete/ })
  while (!(await finish.isVisible())) await page.getByRole('button', { name: 'Next' }).click()
  await finish.click()
  await expect(lessons.getByRole('listitem').filter({ hasText: LESSON }).getByLabel('Done')).toBeVisible()

  // The quiz: shuffled, so each answer is looked up in the content by its question.
  await lessons.getByRole('link', { name: `Quiz: ${MODULE}` }).click()
  const bank = MODULE_QUIZZES['bruno-m1']
  const shownAt: number[] = []
  for (let i = 0; i < bank.length; i++) {
    const group = page.getByRole('group')
    await expect(page.getByText(`Question ${i + 1} / ${bank.length}`)).toBeVisible()
    const asked = (await group.getAttribute('aria-label'))!
    const question = bank.find(q => q.question === asked)!
    const answer = question.options[question.correctIndex]
    const options = await group.getByRole('button').allInnerTexts()
    shownAt.push(options.indexOf(answer))
    await group.getByRole('button', { name: answer, exact: true }).click()
  }
  await expect(page.getByText(`Final score: ${bank.length}/${bank.length}`)).toBeVisible()
  expect(new Set(shownAt).size).toBeGreaterThan(1) // the right answer is not always in the same place
  await page.getByRole('button', { name: 'Complete module' }).click()
  const quizRow = lessons.getByRole('listitem').filter({ hasText: `Quiz: ${MODULE}` })
  await expect(quizRow).toContainText('Passed')

  await page.reload()
  await expect(lessons.getByRole('listitem').filter({ hasText: LESSON }).getByLabel('Done')).toBeVisible()
  await expect(quizRow).toContainText('Passed')
  await expect(page.getByRole('progressbar', { name: `${PATH} progress` })).not.toHaveAttribute('aria-valuenow', '0')
})

test('a lead writes a practice task; the trainee hands it in', async ({ page }) => {
  await login(page, 'automation_lead')
  await page.goto('/learning/practice')
  await page.getByRole('button', { name: 'New practice task' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Title').fill(TASK)
  await dialog.getByLabel('What to do').fill('Add an assertion on the message in tests/test_login_error.py.')
  await dialog.getByLabel('Path (optional)').selectOption({ label: PATH })
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()

  await login(page, 'automation_trainee')
  await page.goto('/learning/practice')
  const task = page.getByRole('list', { name: 'Practice tasks' }).getByRole('listitem').filter({ hasText: TASK })
  await task.getByLabel('Branch').fill('practice/trainee/login-message')
  await task.getByLabel('Note for your mentor (optional)').fill('My first assertion')
  await task.getByRole('button', { name: 'Hand in for review' }).click()
  await expect(task).toContainText('Waiting for review')
})

test("the lead's mentor view shows the progress and approves the practice", async ({ page }) => {
  await login(page, 'automation_lead')
  await page.goto('/learning/mentor')
  const row = page.getByRole('table', { name: 'Mentees' }).getByRole('row').filter({ hasText: 'E2E Automation Trainee' })
  await expect(row).toContainText(PATH)
  await expect(row.getByRole('cell').nth(2)).not.toHaveText('0') // lessons done
  await expect(row.getByRole('cell').nth(3)).not.toHaveText('0') // quizzes passed

  const waiting = page.getByRole('list', { name: 'Practice waiting for review' }).getByRole('listitem').filter({ hasText: TASK })
  await expect(waiting).toContainText('practice/trainee/login-message')
  await waiting.getByLabel('Feedback for E2E Automation Trainee').fill('Clear and focused, well done.')
  await waiting.getByRole('button', { name: 'Approve' }).click()
  await expect(waiting).toHaveCount(0)

  await login(page, 'automation_trainee')
  await page.goto('/learning/practice')
  const task = page.getByRole('list', { name: 'Practice tasks' }).getByRole('listitem').filter({ hasText: TASK })
  await expect(task).toContainText('Approved')
  await expect(task).toContainText('Clear and focused, well done.')
})

test('hints are shared; the trainee sees no mentor tab and cannot edit hints', async ({ page }) => {
  await login(page, 'automation_trainee')
  await page.goto('/learning/hints')
  await expect(page.getByRole('list', { name: 'Hints' })).toContainText('Every test needs an assertion')
  await expect(page.getByRole('button', { name: 'New hint' })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Learning sections' }).getByRole('link', { name: 'Mentor' })).toHaveCount(0)
  await page.goto('/')
  await expect(page.getByText(PATH)).toBeVisible() // Home: my path
})
