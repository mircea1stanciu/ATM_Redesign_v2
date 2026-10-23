// @ts-check
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('web-form.html');
});

test('shows the form', async ({ page }) => {
  await expect(page).toHaveTitle('Web form');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Web form');
});

test('submits the form', async ({ page }) => {
  await page.locator('#my-text-id').fill('Hello from ATM');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Form submitted');
  await expect(page.locator('#message')).toHaveText('Received!');
});
