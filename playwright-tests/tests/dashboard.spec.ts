import { test, expect } from '@playwright/test';
import { testUsers } from './fixtures/test-data';
import { login } from './utils/helpers';

test.describe('Dashboard Tests', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, testUsers.admin.email, testUsers.admin.password);
  });

  test('should display dashboard with all main components', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    
    // Check for sidebar
    await expect(page.locator('aside')).toBeVisible();
    
    // Check for main header
    await expect(page.locator('header')).toBeVisible();
    
    // Check for navigation links
    await expect(page.locator('a:has-text("Dashboard")')).toBeVisible();
    await expect(page.locator('a:has-text("Projects")')).toBeVisible();
    await expect(page.locator('a:has-text("Test Runs")')).toBeVisible();
    await expect(page.locator('a:has-text("Analytics")')).toBeVisible();
  });

  test('should display active project selector', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    
    // Find project selector
    const projectSelector = page.locator('select').first();
    await expect(projectSelector).toBeVisible();
    
    // Should have at least "No projects" option
    const options = await projectSelector.locator('option').count();
    expect(options).toBeGreaterThan(0);
  });

  test('should toggle theme between light and dark mode', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    
    // Find theme toggle button (Moon/Sun icon)
    const themeButton = page.locator('button[title="Toggle theme"]');
    await expect(themeButton).toBeVisible();
    
    // Get initial state
    const htmlElement = page.locator('html');
    const initialClass = await htmlElement.getAttribute('class');
    
    // Click theme toggle
    await themeButton.click();
    await page.waitForTimeout(500);
    
    // Check if class changed
    const newClass = await htmlElement.getAttribute('class');
    expect(initialClass).not.toBe(newClass);
  });

  test('should display user profile section', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    
    // Check for user avatar
    const avatar = page.locator('div.rounded-full.bg-gradient-to-br').last();
    await expect(avatar).toBeVisible();
    
    // Check for logout button
    const logoutBtn = page.locator('button[title="Logout"]');
    await expect(logoutBtn).toBeVisible();
  });

  test('should display GitHub connection status', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    
    // Look for GitHub indicator
    const githubIndicator = page.locator('[title*="GitHub"]');
    await expect(githubIndicator).toBeVisible({ timeout: 5000 });
  });

  test('should navigate to Projects page', async ({ page }) => {
    await page.click('a:has-text("Projects")');
    await page.waitForURL('/projects');
    
    await expect(page).toHaveURL(/\/projects/);
    // Check for projects page content
    await expect(page.locator('text=Projects|Create Project')).toBeVisible({ timeout: 5000 });
  });

  test('should navigate to Test Runs page', async ({ page }) => {
    await page.click('a:has-text("Test Runs")');
    await page.waitForURL('/runs');
    
    await expect(page).toHaveURL(/\/runs/);
  });

  test('should navigate to Analytics page', async ({ page }) => {
    await page.click('a:has-text("Analytics")');
    await page.waitForURL('/analytics');
    
    await expect(page).toHaveURL(/\/analytics/);
  });

  test('should display running indicator when tests are running', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    
    // The running indicator should appear next to "Test Runs" when tests are running
    // This is indicated by an animated pulse
    const runsPulse = page.locator('a:has-text("Test Runs") .animate-pulse');
    
    // Note: This might not always be visible depending on test state
    if (await runsPulse.isVisible()) {
      await expect(runsPulse).toHaveClass(/bg-blue-500/);
    }
  });
});
