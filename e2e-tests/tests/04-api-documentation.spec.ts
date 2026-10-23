import { test, expect } from '@playwright/test';
import { AuthHelper, NavigationHelper, testUsers, waitForPageLoad } from './utils/test-helpers';

test.describe('API Documentation', () => {
  let authHelper: AuthHelper;
  let navigationHelper: NavigationHelper;

  test.beforeEach(async ({ page }) => {
    authHelper = new AuthHelper(page);
    navigationHelper = new NavigationHelper(page);
    
    // Login as super admin to access API docs
    await authHelper.login(testUsers.superAdmin);
    await waitForPageLoad(page);
  });

  test('should display API documentation page', async ({ page }) => {
    await navigationHelper.navigateToSection('api-docs');
    
    // Check for API documentation elements
    await expect(page.locator('h1:has-text("API Documentation"), h2:has-text("API")')).toBeVisible();
    
    // Should show API endpoints
    await expect(page.locator('text=/GET|POST|PUT|DELETE|PATCH/')).toBeVisible();
  });

  test('should show authentication endpoints', async ({ page }) => {
    await navigationHelper.navigateToSection('api-docs');
    
    // Check for auth endpoints
    await expect(page.locator('text=POST /api/auth/login')).toBeVisible();
    await expect(page.locator('text=POST /api/auth/logout')).toBeVisible();
    await expect(page.locator('text=POST /api/auth/refresh')).toBeVisible();
    
    // Check for endpoint descriptions
    await expect(page.locator('text=Login with username and password')).toBeVisible();
  });

  test('should show organization endpoints', async ({ page }) => {
    await navigationHelper.navigateToSection('api-docs');
    
    // Check for organization CRUD endpoints
    await expect(page.locator('text=GET /api/organizations')).toBeVisible();
    await expect(page.locator('text=POST /api/organizations')).toBeVisible();
    await expect(page.locator('text=PUT /api/organizations')).toBeVisible();
    await expect(page.locator('text=DELETE /api/organizations')).toBeVisible();
    
    // Check for specific organization operations
    await expect(page.locator('text=Create a new organization')).toBeVisible();
    await expect(page.locator('text=Update organization details')).toBeVisible();
  });

  test('should show user management endpoints', async ({ page }) => {
    await navigationHelper.navigateToSection('api-docs');
    
    // Check for user endpoints
    await expect(page.locator('text=GET /api/organizations/{id}/users')).toBeVisible();
    await expect(page.locator('text=POST /api/organizations/{id}/users')).toBeVisible();
    await expect(page.locator('text=PUT /api/users/{id}')).toBeVisible();
    await expect(page.locator('text=DELETE /api/users/{id}')).toBeVisible();
    
    // Check for user operation descriptions
    await expect(page.locator('text=Create a new user')).toBeVisible();
    await expect(page.locator('text=Update user information')).toBeVisible();
    await expect(page.locator('text=Delete a user from an organization')).toBeVisible();
  });

  test('should show HTTP methods with proper styling', async ({ page }) => {
    await navigationHelper.navigateToSection('api-docs');
    
    // Check for HTTP method badges/labels
    await expect(page.locator('span:has-text("GET")')).toBeVisible();
    await expect(page.locator('span:has-text("POST")')).toBeVisible();
    await expect(page.locator('span:has-text("PUT"), span:has-text("PATCH")')).toBeVisible();
    await expect(page.locator('span:has-text("DELETE")')).toBeVisible();
    
    // Methods should be visually distinct (colored)
    const getMethod = page.locator('span:has-text("GET")').first();
    await expect(getMethod).toHaveClass(/green|success/);
  });

  test('should show request/response examples', async ({ page }) => {
    await navigationHelper.navigateToSection('api-docs');
    
    // Look for example sections
    await expect(page.locator('text=Request Example, text=Response Example').first()).toBeVisible();
    
    // Should show JSON examples
    await expect(page.locator('code, pre').filter({ hasText: /{/ })).toBeVisible();
    
    // Check for common API response fields
    await expect(page.locator('text="id":, text="name":, text="status":')).toBeVisible();
  });

  test('should show authentication requirements', async ({ page }) => {
    await navigationHelper.navigateToSection('api-docs');
    
    // Check for authentication documentation
    await expect(page.locator('text=Authorization, text=Bearer token')).toBeVisible();
    
    // Should explain authentication process
    await expect(page.locator('text=Authorization header, text=JWT')).toBeVisible();
  });

  test('should show error codes and responses', async ({ page }) => {
    await navigationHelper.navigateToSection('api-docs');
    
    // Check for error documentation
    await expect(page.locator('text=400, text=401, text=403, text=404, text=500').first()).toBeVisible();
    
    // Should explain error responses
    await expect(page.locator('text=Bad Request, text=Unauthorized').first()).toBeVisible();
    await expect(page.locator('text=Forbidden, text=Not Found').first()).toBeVisible();
  });

  test('should provide interactive API testing', async ({ page }) => {
    await navigationHelper.navigateToSection('api-docs');
    
    // Check for "Try it out" buttons
    const tryButton = page.locator('button:has-text("Try it out"), button:has-text("Test")');
    if (await tryButton.isVisible()) {
      await tryButton.click();
      
      // Should show input fields for testing
      await expect(page.locator('input[placeholder*="API"], textarea').first()).toBeVisible();
    }
  });

  test('should show API versioning information', async ({ page }) => {
    await navigationHelper.navigateToSection('api-docs');
    
    // Check for version information
    await expect(page.locator('text=Version, text=v1, text=API v').first()).toBeVisible();
    
    // Should show base URL
    await expect(page.locator('text=http://localhost:8002/api, text=Base URL').first()).toBeVisible();
  });

  test('should have searchable documentation', async ({ page }) => {
    await navigationHelper.navigateToSection('api-docs');
    
    // Look for search functionality
    const searchInput = page.locator('input[placeholder*="Search"], input[name="search"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill('users');
      await page.waitForTimeout(500);
      
      // Should show filtered results
      await expect(page.locator('text=/users?/i')).toBeVisible();
    }
  });
});
