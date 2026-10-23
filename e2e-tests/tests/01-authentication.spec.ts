import { test, expect, Page, TestInfo } from '@playwright/test';
import { AuthHelper, testUsers, waitForPageLoad } from './utils/test-helpers';

// Configure this test suite to capture videos
test.use({ video: 'on-first-retry' });

// Helper to attach screenshots to the test report
const attachScreenshot = async (page: Page, testInfo: TestInfo, name: string, description: string = '') => {
  const screenshotBuffer = await page.screenshot({ fullPage: true });
  await testInfo.attach(description || name, {
    body: screenshotBuffer,
    contentType: 'image/png'
  });
};

test.describe('Authentication Flow', () => {
  let authHelper: AuthHelper;

  test.beforeEach(async ({ page }) => {
    authHelper = new AuthHelper(page);
    await waitForPageLoad(page);
  });

  test('should display login page correctly', async ({ page }) => {
    await page.goto('/login');
    
    // Check that login form elements are present
    await expect(page.locator('input[name="username"], input[placeholder*="username"]')).toBeVisible();
    await expect(page.locator('input[name="password"], input[placeholder*="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign In")')).toBeVisible();
    
    // Check for UnifiedWork branding (be more specific to avoid multiple matches)
    await expect(page.locator('h1:has-text("UnifiedWork"), h2:has-text("UnifiedWork")').first()).toBeVisible();
  });

  test('should login as super admin successfully', async ({ page }, testInfo) => {
    await authHelper.login(testUsers.superAdmin);
    
    // Verify we're on the admin or dashboard page
    await expect(page).toHaveURL(/\/(admin|dashboard)/);
    
    // Check for admin/dashboard specific elements
    await expect(page.locator('text=Total Organizations, text=Organizations Management').first()).toBeVisible();
    
    // 📸 Capture success screenshot
    await attachScreenshot(page, testInfo, 'super-admin-login', '✅ Super Admin Successfully Logged In');
  });

  test('should login as organization admin successfully', async ({ page }, testInfo) => {
    await authHelper.login(testUsers.orgAdmin);
    
    // Verify we're on the admin or dashboard page
    await expect(page).toHaveURL(/\/(admin|dashboard)/);
    
    // Check for org admin specific elements
    await expect(page.locator('text=Organization Users, text=Users Management').first()).toBeVisible();
    
    // 📸 Capture success screenshot
    await attachScreenshot(page, testInfo, 'org-admin-login', '✅ Organization Admin Successfully Logged In');
  });

  test('should login as regular user successfully', async ({ page }, testInfo) => {
    await authHelper.login(testUsers.regularUser);
    
    // Verify we're on the admin or dashboard page
    await expect(page).toHaveURL(/\/(admin|dashboard)/);
    
    // Regular user should see basic information
    await expect(page.locator('text=Active Users, h1, h2').first()).toBeVisible();
    
    // 📸 Capture success screenshot
    await attachScreenshot(page, testInfo, 'regular-user-login', '✅ Regular User Successfully Logged In');
  });

  test('should reject invalid login credentials', async ({ page }) => {
    await page.goto('/login');
    
    await page.fill('input[name="username"]', 'invalid_user');
    await page.fill('input[name="password"]', 'wrong_password');
    await page.click('button[type="submit"]');
    
    // Should show error message
    await expect(page.locator('text=Invalid credentials')).toBeVisible({ timeout: 5000 });
    
    // Should remain on login page
    await expect(page).toHaveURL('/login');
  });

  test('should handle organization slug correctly for org users', async ({ page }) => {
    await page.goto('/login');
    
    await page.fill('input[name="username"], input[placeholder*="username"]', testUsers.orgAdmin.username);
    await page.fill('input[name="password"], input[placeholder*="password"]', testUsers.orgAdmin.password);
    
    // Fill organization slug if the field exists
    const orgSlugInput = page.locator('input[name="organization_slug"], input[placeholder*="organization"]');
    if (await orgSlugInput.isVisible()) {
      await orgSlugInput.fill(testUsers.orgAdmin.organizationSlug!);
    }
    
    await page.click('button[type="submit"], button:has-text("Login"), button:has-text("Sign In")');
    
    // Should successfully login
    await expect(page).toHaveURL(/\/(admin|dashboard)/);
  });

  test('should logout successfully', async ({ page }, testInfo) => {
    // Login first
    await authHelper.login(testUsers.superAdmin);
    
    // Perform logout
    await authHelper.logout();
    
    // Should redirect to login page
    await expect(page).toHaveURL('/login');
    
    // 📸 Capture success screenshot
    await attachScreenshot(page, testInfo, 'logout-success', '✅ Logout Completed Successfully');
  });

  test('should redirect to login when accessing protected route without authentication', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Should redirect to login
    await expect(page).toHaveURL('/login');
  });

  test('should maintain session after page refresh', async ({ page }, testInfo) => {
    // Login first
    await authHelper.login(testUsers.superAdmin);
    
    // Refresh the page
    await page.reload();
    
    // Should still be on admin/dashboard
    await expect(page).toHaveURL(/\/(admin|dashboard)/);
    await expect(page.locator('h1, h2, nav').first()).toBeVisible();
    
    // 📸 Capture success screenshot
    await attachScreenshot(page, testInfo, 'session-refresh-success', '✅ Session Maintained After Page Refresh');
  });
});
