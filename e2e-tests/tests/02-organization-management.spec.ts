import { test, expect } from '@playwright/test';
import { 
  AuthHelper, 
  NavigationHelper, 
  FormHelper, 
  ModalHelper, 
  DeleteHelper,
  testUsers, 
  generateTestData, 
  waitForPageLoad 
} from './utils/test-helpers';

test.describe('Organization Management', () => {
  let authHelper: AuthHelper;
  let navigationHelper: NavigationHelper;
  let formHelper: FormHelper;
  let modalHelper: ModalHelper;
  let deleteHelper: DeleteHelper;

  test.beforeEach(async ({ page }) => {
    authHelper = new AuthHelper(page);
    navigationHelper = new NavigationHelper(page);
    formHelper = new FormHelper(page);
    modalHelper = new ModalHelper(page);
    deleteHelper = new DeleteHelper(page);
    
    // Login as super admin for org management
    await authHelper.login(testUsers.superAdmin);
    await waitForPageLoad(page);
  });

  test('should display organizations list', async ({ page }) => {
    await navigationHelper.navigateToSection('organizations');
    
    // Check for organizations table
    await expect(page.locator('table, thead, th:has-text("Organization")')).toBeVisible();
    
    // Check for organization data columns
    await expect(page.locator('th:has-text("Name")')).toBeVisible();
    await expect(page.locator('th:has-text("Slug")')).toBeVisible();
    await expect(page.locator('th:has-text("Users")')).toBeVisible();
  });

  test('should create new organization', async ({ page }) => {
    await navigationHelper.navigateToSection('organizations');
    
    // Click create organization button
    await page.click('button:has-text("Create Organization")');
    await modalHelper.waitForModal();
    
    // Fill organization form
    const orgData = {
      name: generateTestData.randomOrgName(),
      slug: generateTestData.randomOrgSlug(),
      admin_email: generateTestData.randomEmail(),
      admin_username: generateTestData.randomUsername(),
      admin_password: 'admin123',
      subscription_plan: 'basic'
    };
    
    await formHelper.fillForm(orgData);
    await formHelper.submitForm();
    
    // Should show success message
    await expect(page.locator('text=Organization created successfully')).toBeVisible();
    
    // Should see new organization in list
    await expect(page.locator(`text=${orgData.name}`)).toBeVisible();
  });

  test('should edit organization details', async ({ page }) => {
    await navigationHelper.navigateToSection('organizations');
    
    // Find first organization and edit
    const firstOrgRow = page.locator('tbody tr').first();
    await firstOrgRow.locator('button:has-text("Edit")').click();
    
    await modalHelper.waitForModal();
    
    // Update organization name
    const newName = `Updated ${generateTestData.randomOrgName()}`;
    await page.fill('input[name="name"]', newName);
    
    await formHelper.submitForm();
    
    // Should show success message
    await expect(page.locator('text=Organization updated successfully')).toBeVisible();
  });

  test('should manage organization subscription plans', async ({ page }) => {
    await navigationHelper.navigateToSection('organizations');
    
    // Find organization and edit
    const orgRow = page.locator('tbody tr').first();
    await orgRow.locator('button:has-text("Edit")').click();
    
    await modalHelper.waitForModal();
    
    // Check subscription plan options
    const planSelect = page.locator('select[name="subscription_plan"]');
    await expect(planSelect).toBeVisible();
    
    // Should have different plan options
    await expect(planSelect.locator('option:has-text("Basic")')).toBeVisible();
    await expect(planSelect.locator('option:has-text("Premium")')).toBeVisible();
    
    // Change subscription plan
    await planSelect.selectOption('premium');
    await formHelper.submitForm();
    
    await expect(page.locator('text=Organization updated successfully')).toBeVisible();
  });

  test('should block/unblock organization', async ({ page }) => {
    await navigationHelper.navigateToSection('organizations');
    
    // Find organization to block
    const orgRow = page.locator('tbody tr').first();
    const orgName = await orgRow.locator('td').first().textContent();
    
    // Block organization
    await orgRow.locator('button:has-text("Block"), button:has-text("Actions")').click();
    
    // If it's an actions menu, find block option
    const blockButton = page.locator('button:has-text("Block")');
    if (await blockButton.isVisible()) {
      await blockButton.click();
    }
    
    // Confirm blocking
    await modalHelper.confirmAction();
    
    // Should show blocked status
    await expect(page.locator(`text=${orgName}`).locator('..').locator('text=Blocked')).toBeVisible();
    
    // Unblock organization
    await orgRow.locator('button:has-text("Unblock"), button:has-text("Actions")').click();
    
    const unblockButton = page.locator('button:has-text("Unblock")');
    if (await unblockButton.isVisible()) {
      await unblockButton.click();
    }
    
    // Should show active status
    await expect(page.locator(`text=${orgName}`).locator('..').locator('text=Active')).toBeVisible();
  });

  test('should view organization users', async ({ page }) => {
    await navigationHelper.navigateToSection('organizations');
    
    // Click on first organization to view users
    const firstOrgRow = page.locator('tbody tr').first();
    await firstOrgRow.locator('button:has-text("View Users"), a:has-text("Users")').click();
    
    // Should navigate to users view for that organization
    await expect(page.locator('h1:has-text("Users"), h2:has-text("Organization Users")')).toBeVisible();
    
    // Should show users table
    await expect(page.locator('table, th:has-text("Username")')).toBeVisible();
  });

  test('should delete organization with confirmation', async ({ page }) => {
    // First create a test organization to delete
    await navigationHelper.navigateToSection('organizations');
    await page.click('button:has-text("Create Organization")');
    await modalHelper.waitForModal();
    
    const testOrgData = {
      name: `DeleteMe ${generateTestData.randomString()}`,
      slug: `deleteme-${generateTestData.randomString()}`,
      admin_email: generateTestData.randomEmail(),
      admin_username: `deleteme_${generateTestData.randomString()}`,
      admin_password: 'admin123',
      subscription_plan: 'basic'
    };
    
    await formHelper.fillForm(testOrgData);
    await formHelper.submitForm();
    await expect(page.locator('text=Organization created successfully')).toBeVisible();
    
    // Now delete the organization using the corrected delete flow
    const orgToDelete = page.locator(`tbody tr:has-text("${testOrgData.name}")`);
    await deleteHelper.performDelete(`tbody tr:has-text("${testOrgData.name}")`, testOrgData.name);
    
    // Verify organization is deleted
    await expect(page.locator(`text=${testOrgData.name}`)).not.toBeVisible();
  });

  test('should filter and search organizations', async ({ page }) => {
    await navigationHelper.navigateToSection('organizations');
    
    // Check for search functionality
    const searchInput = page.locator('input[placeholder*="Search"], input[name="search"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill('test');
      await page.waitForTimeout(500); // Wait for search results
      
      // Should filter results
      const searchResults = page.locator('tbody tr');
      await expect(searchResults.first()).toBeVisible();
    }
    
    // Check for filter options if available
    const filterDropdown = page.locator('select[name="status"], select[name="plan"]');
    if (await filterDropdown.isVisible()) {
      await filterDropdown.selectOption({ index: 1 });
      await page.waitForTimeout(500);
    }
  });
});
