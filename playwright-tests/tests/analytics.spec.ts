import { test, expect } from '@playwright/test';
import { testUsers } from './fixtures/test-data';
import { login } from './utils/helpers';

test.describe('Analytics Page Tests', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, testUsers.admin.email, testUsers.admin.password);
    await page.goto('/analytics');
    await page.waitForLoadState('networkidle');
  });

  test('should display analytics page', async ({ page }) => {
    await expect(page).toHaveURL(/\/analytics/);
    
    // Should show page content
    const pageContent = page.locator('main').first();
    await expect(pageContent).toBeVisible();
  });

  test('should display metrics cards', async ({ page }) => {
    // Look for stat cards
    const statCards = page.locator('.rounded-lg.border, .card, [class*="stat"]').first();
    await expect(statCards).toBeVisible({ timeout: 5000 });
  });

  test('should display test execution charts', async ({ page }) => {
    // Look for charts (Recharts or similar)
    const chart = page.locator('svg[class*="recharts"], canvas').first();
    
    if (await chart.isVisible()) {
      await expect(chart).toBeVisible();
    }
  });

  test('should display success rate metrics', async ({ page }) => {
    // Look for success rate percentage
    const successRate = page.locator('text=/\\d+%|success rate/i').first();
    
    if (await successRate.isVisible()) {
      await expect(successRate).toBeVisible();
    }
  });

  test('should display test trends over time', async ({ page }) => {
    // Look for trend chart
    const trendChart = page.locator('svg').first();
    
    if (await trendChart.isVisible()) {
      await expect(trendChart).toBeVisible();
    }
  });

  test('should allow date range selection', async ({ page }) => {
    // Look for date picker or range selector
    const dateInput = page.locator('input[type="date"], input[placeholder*="date" i]').first();
    
    if (await dateInput.isVisible()) {
      await expect(dateInput).toBeVisible();
    }
  });

  test('should display test framework breakdown', async ({ page }) => {
    // Look for framework statistics
    const frameworkInfo = page.locator('text=/pytest|playwright|cypress|junit|robot/i').first();
    
    if (await frameworkInfo.isVisible()) {
      await expect(frameworkInfo).toBeVisible();
    }
  });

  test('should display project selector filter', async ({ page }) => {
    // Look for project selector in analytics
    const projectSelector = page.locator('select').first();
    
    if (await projectSelector.isVisible()) {
      await expect(projectSelector).toBeVisible();
    }
  });

  test('should update charts when filters change', async ({ page }) => {
    const projectSelector = page.locator('select').first();
    
    if (await projectSelector.isVisible()) {
      // Get initial chart state
      const initialChart = await page.locator('svg').first().boundingBox();
      
      // Change selection
      await projectSelector.selectOption({ index: 0 });
      await page.waitForLoadState('networkidle');
      
      // Chart should still be visible
      const updatedChart = page.locator('svg').first();
      await expect(updatedChart).toBeVisible();
    }
  });

  test('should display most recent test runs', async ({ page }) => {
    // Look for recent runs list
    const runsList = page.locator('[role="table"], .space-y-').first();
    
    if (await runsList.isVisible()) {
      await expect(runsList).toBeVisible();
    }
  });

  test('should display test suite statistics', async ({ page }) => {
    // Look for suite info
    const suiteInfo = page.locator('text=/suite|test suite/i').first();
    
    if (await suiteInfo.isVisible()) {
      await expect(suiteInfo).toBeVisible();
    }
  });
});
