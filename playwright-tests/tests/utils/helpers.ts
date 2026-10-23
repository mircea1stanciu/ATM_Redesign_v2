import { Page } from '@playwright/test';

/**
 * Test helper functions
 */

export async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('/');
}

export async function logout(page: Page) {
  await page.click('button[title="Logout"]');
  await page.waitForURL('/login');
}

export async function navigateTo(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

export async function waitForElement(page: Page, selector: string, timeout = 5000) {
  await page.waitForSelector(selector, { timeout });
}

export async function isElementVisible(page: Page, selector: string): Promise<boolean> {
  return await page.isVisible(selector);
}

export async function clickAndWait(page: Page, selector: string, waitFor?: string) {
  await page.click(selector);
  if (waitFor) {
    await page.waitForSelector(waitFor);
  } else {
    await page.waitForLoadState('networkidle');
  }
}
