import { test, expect } from '@playwright/test';
import { AuthHelper, testUsers, waitForPageLoad } from './utils/test-helpers';

test.describe('Authentication Flow - Demo', () => {
  let authHelper: AuthHelper;

  test.beforeEach(async ({ page }) => {
    authHelper = new AuthHelper(page);
    await waitForPageLoad(page);
  });

  test('should login as super admin successfully - DEMO', async ({ page }) => {
    console.log('🚀 Starting login flow...');
    
    // Navigate to login page
    console.log('📍 Navigating to login page...');
    await page.goto('/login');
    await page.waitForTimeout(1500);
    
    // Wait for login form to be visible
    console.log('⏳ Waiting for login form...');
    await expect(page.locator('input[name="username"], input[placeholder*="username"]')).toBeVisible();
    await expect(page.locator('input[name="password"], input[placeholder*="password"]')).toBeVisible();
    await page.waitForTimeout(1500);
    
    // Fill username
    console.log('✍️  Entering username: ' + testUsers.superAdmin.username);
    await page.fill('input[name="username"], input[placeholder*="username"]', testUsers.superAdmin.username);
    await page.waitForTimeout(1500);
    
    // Fill password
    console.log('✍️  Entering password');
    await page.fill('input[name="password"], input[placeholder*="password"]', testUsers.superAdmin.password);
    await page.waitForTimeout(1500);
    
    // Click submit button
    console.log('🔐 Clicking login button...');
    await page.click('button[type="submit"], button:has-text("Login"), button:has-text("Sign In")');
    await page.waitForTimeout(2000);
    
    // Wait for redirect to admin or dashboard
    console.log('⏳ Waiting for redirect to admin/dashboard...');
    await expect(page).toHaveURL(/\/(admin|dashboard)/, { timeout: 15000 });
    await page.waitForTimeout(1500);
    
    // Verify we're on the dashboard
    console.log('✅ Successfully logged in! Checking dashboard elements...');
    await expect(page.locator('h1, h2, nav').first()).toBeVisible();
    await page.waitForTimeout(1500);
    
    console.log('🎉 Login flow completed successfully!');
  });
});
