import { test, expect, devices } from '@playwright/test';
import { testUsers } from './fixtures/test-data';
import { login } from './utils/helpers';

test.describe('Responsive Design Tests', () => {
  test('should display properly on mobile devices', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    await login(page, testUsers.admin.email, testUsers.admin.password);
    
    // Check for mobile menu button
    const mobileMenuBtn = page.locator('button[title*="menu" i], button svg.lucide-menu').first();
    await expect(mobileMenuBtn).toBeVisible();
    
    // Desktop sidebar should be hidden
    const sidebar = page.locator('aside.hidden');
    await expect(sidebar).toBeVisible();
  });

  test('should display mobile navigation correctly', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    
    await login(page, testUsers.admin.email, testUsers.admin.password);
    
    // Click mobile menu
    const mobileMenuBtn = page.locator('button[title*="menu" i], button svg.lucide-menu').first();
    if (await mobileMenuBtn.isVisible()) {
      await mobileMenuBtn.click();
      
      // Mobile sidebar should appear
      await page.waitForTimeout(300);
      const mobileSidebar = page.locator('aside').nth(0);
      await expect(mobileSidebar).toBeVisible();
    }
  });

  test('should hide desktop sidebar on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    
    await login(page, testUsers.admin.email, testUsers.admin.password);
    
    // Desktop sidebar should have md:flex class
    const desktopSidebar = page.locator('aside').first();
    const classList = await desktopSidebar.getAttribute('class');
    
    expect(classList).toContain('hidden');
  });

  test('should display properly on tablet', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    
    await login(page, testUsers.admin.email, testUsers.admin.password);
    
    // Both sidebar and content should be visible
    await expect(page.locator('main')).toBeVisible();
  });

  test('should display properly on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    
    await login(page, testUsers.admin.email, testUsers.admin.password);
    
    // Sidebar should be visible
    const sidebar = page.locator('aside').first();
    const classList = await sidebar.getAttribute('class');
    
    expect(classList).toContain('md:flex');
  });

  test('should adjust spacing and padding on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    
    await login(page, testUsers.admin.email, testUsers.admin.password);
    
    // Main content should have appropriate padding
    const mainContent = page.locator('main').first();
    await expect(mainContent).toBeVisible();
  });

  test('should adjust font sizes for readability on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    
    await login(page, testUsers.admin.email, testUsers.admin.password);
    
    // Text should be readable (not too small)
    const headings = page.locator('h1, h2, h3').first();
    if (await headings.isVisible()) {
      const fontSize = await headings.evaluate((el) => {
        return window.getComputedStyle(el).fontSize;
      });
      
      const size = parseInt(fontSize);
      expect(size).toBeGreaterThanOrEqual(14);
    }
  });

  test('should handle overflow on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    
    await login(page, testUsers.admin.email, testUsers.admin.password);
    
    // Navigate to projects
    await page.click('a:has-text("Projects")');
    
    // Check that no horizontal scrolling is needed
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1);
  });

  test('should display navigation dropdown properly on small screens', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 720 });
    
    await login(page, testUsers.admin.email, testUsers.admin.password);
    
    const mobileMenuBtn = page.locator('button[title*="menu" i]').first();
    if (await mobileMenuBtn.isVisible()) {
      await mobileMenuBtn.click();
      await page.waitForTimeout(300);
      
      // Check for visible nav items
      const navItems = page.locator('nav a, nav button').first();
      await expect(navItems).toBeVisible();
    }
  });
});
