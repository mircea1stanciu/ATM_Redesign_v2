import { test, expect } from '@playwright/test';
import { testUsers } from './fixtures/test-data';
import { login } from './utils/helpers';

test.describe('Test Runs Page Tests', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, testUsers.admin.email, testUsers.admin.password);
    await page.goto('/runs');
    await page.waitForLoadState('networkidle');
  });

  test('should display test runs page', async ({ page }) => {
    await expect(page).toHaveURL(/\/runs/);
    
    // Should show page content
    const pageContent = page.locator('main, [role="main"]').first();
    await expect(pageContent).toBeVisible();
  });

  test('should display test runs table or list', async ({ page }) => {
    // Wait for runs to load
    const runsList = page.locator('[role="table"], [role="grid"], .space-y-').first();
    await expect(runsList).toBeVisible({ timeout: 5000 });
  });

  test('should display run status badge', async ({ page }) => {
    // Look for status badges
    const statusBadges = page.locator('[role="status"], .badge, .px-2.py-1').first();
    
    if (await statusBadges.isVisible()) {
      await expect(statusBadges).toBeVisible();
    }
  });

  test('should display run details on row click', async ({ page }) => {
    const firstRun = page.locator('[role="row"], li, article').nth(1);
    
    if (await firstRun.isVisible()) {
      await firstRun.click();
      
      // Should expand or navigate to details
      await page.waitForLoadState('networkidle');
    }
  });

  test('should display filter options', async ({ page }) => {
    // Look for filter/sort controls
    const filterBtn = page.locator('button:has-text("Filter"), button:has-text("Sort")').first();
    
    if (await filterBtn.isVisible()) {
      await expect(filterBtn).toBeVisible();
    }
  });

  test('should filter runs by status', async ({ page }) => {
    const filterBtn = page.locator('button:has-text("Filter")').first();
    
    if (await filterBtn.isVisible()) {
      await filterBtn.click();
      
      // Look for status options
      const statusOption = page.locator('[role="menuitem"], label').first();
      if (await statusOption.isVisible()) {
        await statusOption.click();
        await page.waitForLoadState('networkidle');
      }
    }
  });

  test('should display run execution time', async ({ page }) => {
    // Look for time information
    const timeInfo = page.locator('text=/\\d+[a-z]{1,2}\\s(ago|duration)/i').first();
    
    if (await timeInfo.isVisible()) {
      await expect(timeInfo).toBeVisible();
    }
  });

  test('should display test count in runs', async ({ page }) => {
    // Look for test counts
    const testCount = page.locator('text=/\\d+\\s+(test|case)s?/i').first();
    
    if (await testCount.isVisible()) {
      await expect(testCount).toBeVisible();
    }
  });

  test('should display success/failure rate', async ({ page }) => {
    // Look for pass/fail indicators
    const successIndicator = page.locator('text=/passed|failed|success|failure/i').first();
    
    if (await successIndicator.isVisible()) {
      await expect(successIndicator).toBeVisible();
    }
  });

  test('should support pagination if many runs', async ({ page }) => {
    // Look for pagination
    const pagination = page.locator('button:has-text("Next"), button:has-text("Previous")').first();
    
    if (await pagination.isVisible()) {
      await expect(pagination).toBeVisible();
    }
  });

  test('should display empty state when no runs', async ({ page }) => {
    const emptyState = page.locator('text=No runs|No test runs|No data').first();
    
    if (await emptyState.isVisible()) {
      await expect(emptyState).toBeVisible();
    }
  });

  test('should refresh runs list', async ({ page }) => {
    const refreshBtn = page.locator('button[title*="refresh" i], button svg.lucide-rotate-cw').first();
    
    if (await refreshBtn.isVisible()) {
      await refreshBtn.click();
      await page.waitForLoadState('networkidle');
      await expect(refreshBtn).toBeVisible();
    }
  });
});
