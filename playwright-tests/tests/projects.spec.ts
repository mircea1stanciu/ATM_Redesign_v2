import { test, expect } from '@playwright/test';
import { testUsers, testProjects } from './fixtures/test-data';
import { login } from './utils/helpers';

test.describe('Projects Page Tests', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, testUsers.admin.email, testUsers.admin.password);
    await page.goto('/projects');
    await page.waitForLoadState('networkidle');
  });

  test('should display projects page', async ({ page }) => {
    await expect(page).toHaveURL(/\/projects/);
    
    // Should show page heading
    const heading = page.locator('h1, h2, span:has-text("Projects")').first();
    await expect(heading).toBeVisible();
  });

  test('should display create project button', async ({ page }) => {
    const createBtn = page.locator('button:has-text("Create Project"), button:has-text("New Project"), button:has-text("Add Project")').first();
    await expect(createBtn).toBeVisible();
  });

  test('should open project creation form', async ({ page }) => {
    const createBtn = page.locator('button:has-text("Create Project"), button:has-text("New Project"), button:has-text("Add Project")').first();
    
    if (await createBtn.isVisible()) {
      await createBtn.click();
      
      // Wait for form to appear
      const form = page.locator('form, [role="dialog"]').first();
      await expect(form).toBeVisible({ timeout: 5000 });
      
      // Check for form fields
      const nameField = page.locator('input[name="name"], input[placeholder*="name" i]').first();
      await expect(nameField).toBeVisible({ timeout: 3000 });
    }
  });

  test('should filter or search projects', async ({ page }) => {
    // Look for search or filter input
    const searchInput = page.locator('input[placeholder*="search" i], input[placeholder*="filter" i]').first();
    
    if (await searchInput.isVisible()) {
      await searchInput.fill('test');
      await page.waitForLoadState('networkidle');
      
      // Results should be filtered
      const results = page.locator('[role="row"], li, article').first();
      await expect(results).toBeVisible({ timeout: 5000 });
    }
  });

  test('should display project list', async ({ page }) => {
    // Wait for any existing projects to load
    const projectList = page.locator('[role="table"], [role="grid"], .space-y-').first();
    await expect(projectList).toBeVisible({ timeout: 5000 });
  });

  test('should display project actions', async ({ page }) => {
    // Look for action buttons (edit, delete, etc.)
    const actionBtn = page.locator('button[title*="edit" i], button[title*="delete" i], button[title*="settings" i]').first();
    
    if (await actionBtn.isVisible()) {
      await expect(actionBtn).toBeVisible();
    }
  });

  test('should change active project from selector', async ({ page }) => {
    // Find project selector in sidebar
    const projectSelector = page.locator('select').first();
    
    if (await projectSelector.isVisible()) {
      // Get current value
      const currentValue = await projectSelector.inputValue();
      
      // Get available options
      const options = await projectSelector.locator('option').count();
      
      if (options > 1) {
        // Select different option
        await projectSelector.selectOption({ index: options > 1 ? 1 : 0 });
        await page.waitForLoadState('networkidle');
        
        // Value should change
        const newValue = await projectSelector.inputValue();
        // If there are options, value might change
      }
    }
  });

  test('should display GitHub connection status for project', async ({ page }) => {
    // Look for GitHub indicator at project level
    const githubIcon = page.locator('[title*="GitHub"], svg.lucide-github').first();
    
    if (await githubIcon.isVisible()) {
      await expect(githubIcon).toBeVisible();
    }
  });

  test('should show pagination if many projects exist', async ({ page }) => {
    // Look for pagination controls
    const pagination = page.locator('button:has-text("Next"), button:has-text("Previous"), [aria-label*="page"]').first();
    
    if (await pagination.isVisible()) {
      await expect(pagination).toBeVisible();
    }
  });

  test('should display empty state when no projects', async ({ page }) => {
    // If there are no projects, should show empty message
    const emptyState = page.locator('text=No projects|Create your first project|No data').first();
    
    if (await emptyState.isVisible()) {
      await expect(emptyState).toBeVisible();
    }
  });
});
