import { expect, test } from '@playwright/test'
import { login } from './helpers'

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
