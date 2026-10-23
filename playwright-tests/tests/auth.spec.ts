import { test, expect } from '@playwright/test';
import { testUsers } from './fixtures/test-data';
import { login, logout } from './utils/helpers';

test.describe('Authentication Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('should display login page', async ({ page }) => {
    await expect(page).toHaveTitle(/.*login.*|.*atm.*/i);
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.fill('input[name="email"]', 'invalid@test.com');
    await page.fill('input[name="password"]', 'wrong-password');
    await page.click('button[type="submit"]');
    
    // Wait for error message
    const errorMessage = page.locator('[role="alert"], .error, .text-red-500').first();
    await expect(errorMessage).toBeVisible({ timeout: 5000 });
  });

  test('should successfully login with valid admin credentials', async ({ page }) => {
    await login(page, testUsers.admin.email, testUsers.admin.password);
    
    // Should be redirected to dashboard
    await expect(page).toHaveURL(/\//);
    
    // Check for dashboard elements
    await expect(page.locator('text=Dashboard|AutomationTestManager')).toBeVisible({ timeout: 5000 });
  });

  test('should successfully login with valid lead credentials', async ({ page }) => {
    await login(page, testUsers.lead.email, testUsers.lead.password);
    
    await expect(page).toHaveURL(/\//);
    await expect(page.locator('text=Dashboard|AutomationTestManager')).toBeVisible({ timeout: 5000 });
  });

  test('should logout successfully', async ({ page }) => {
    // First login
    await login(page, testUsers.admin.email, testUsers.admin.password);
    
    // Then logout
    await logout(page);
    
    // Should be back at login page
    await expect(page).toHaveURL(/login/);
  });

  test('should show required field validation', async ({ page }) => {
    // Try to submit without filling fields
    await page.click('button[type="submit"]');
    
    // Check for validation messages
    const emailInput = page.locator('input[name="email"]');
    const passwordInput = page.locator('input[name="password"]');
    
    const isEmailInvalid = await emailInput.evaluate((el: HTMLInputElement) => !el.validity.valid);
    const isPasswordInvalid = await passwordInput.evaluate((el: HTMLInputElement) => !el.validity.valid);
    
    expect(isEmailInvalid || isPasswordInvalid).toBeTruthy();
  });

  test('should persist session on page refresh', async ({ page }) => {
    await login(page, testUsers.admin.email, testUsers.admin.password);
    
    // Refresh page
    await page.reload();
    
    // Should still be logged in
    await expect(page).toHaveURL(/\//);
    await expect(page.locator('text=Dashboard|AutomationTestManager')).toBeVisible({ timeout: 5000 });
  });

  test('should redirect to login if accessing protected route without auth', async ({ page }) => {
    await page.goto('/projects');
    
    // Should be redirected to login
    await expect(page).toHaveURL(/login/, { timeout: 5000 });
  });
});
