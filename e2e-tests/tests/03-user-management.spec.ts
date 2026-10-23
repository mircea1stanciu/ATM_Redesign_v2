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

test.describe('User Management', () => {
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
    
    // Login as organization admin for user management
    await authHelper.login(testUsers.orgAdmin);
    await waitForPageLoad(page);
  });

  test('should display users list', async ({ page }) => {
    await navigationHelper.navigateToSection('users');
    
    // Check for users table
    await expect(page.locator('table, thead, th:has-text("User")')).toBeVisible();
    
    // Check for user data columns
    await expect(page.locator('th:has-text("Username"), th:has-text("Name")')).toBeVisible();
    await expect(page.locator('th:has-text("Email")')).toBeVisible();
    await expect(page.locator('th:has-text("Role")')).toBeVisible();
  });

  test('should create new user', async ({ page }) => {
    await navigationHelper.navigateToSection('users');
    
    // Click create user button
    await page.click('button:has-text("Create User")');
    await modalHelper.waitForModal();
    
    // Fill user form
    const userData = {
      username: generateTestData.randomUsername(),
      email: generateTestData.randomEmail(),
      password: 'testpass123',
      full_name: 'Test User',
      role: 'user'
    };
    
    await formHelper.fillForm(userData);
    
    // Select organization if dropdown exists
    const orgSelect = page.locator('select[name="organization_id"]');
    if (await orgSelect.isVisible()) {
      await orgSelect.selectOption({ index: 1 });
    }
    
    await formHelper.submitForm();
    
    // Should show success message
    await expect(page.locator('text=User created successfully')).toBeVisible();
    
    // Should see new user in list
    await expect(page.locator(`text=${userData.username}`)).toBeVisible();
  });

  test('should edit user details', async ({ page }) => {
    await navigationHelper.navigateToSection('users');
    
    // Find first user and edit
    const firstUserRow = page.locator('tbody tr').first();
    await firstUserRow.locator('button:has-text("Edit")').click();
    
    await modalHelper.waitForModal();
    
    // Update user full name
    const newName = `Updated ${generateTestData.randomString()}`;
    await page.fill('input[name="full_name"]', newName);
    
    await formHelper.submitForm();
    
    // Should show success message
    await expect(page.locator('text=User updated successfully')).toBeVisible();
  });

  test('should assign user to communities', async ({ page }) => {
    await navigationHelper.navigateToSection('users');
    
    // Find user and edit
    const userRow = page.locator('tbody tr').first();
    await userRow.locator('button:has-text("Edit")').click();
    
    await modalHelper.waitForModal();
    
    // Check for community assignment section
    const communitySection = page.locator('[data-testid="community-assignment"], fieldset:has-text("Communities")');
    if (await communitySection.isVisible()) {
      // Select some communities
      const communityCheckboxes = page.locator('input[type="checkbox"][name*="community"]');
      const firstCheckbox = communityCheckboxes.first();
      if (await firstCheckbox.isVisible()) {
        await firstCheckbox.check();
      }
    }
    
    await formHelper.submitForm();
    await expect(page.locator('text=User updated successfully')).toBeVisible();
  });

  test('should manage user roles', async ({ page }) => {
    await navigationHelper.navigateToSection('users');
    
    // Find user and edit
    const userRow = page.locator('tbody tr').first();
    await userRow.locator('button:has-text("Edit")').click();
    
    await modalHelper.waitForModal();
    
    // Change user role
    const roleSelect = page.locator('select[name="role"]');
    await expect(roleSelect).toBeVisible();
    
    // Should have role options
    await expect(roleSelect.locator('option:has-text("User")')).toBeVisible();
    await expect(roleSelect.locator('option:has-text("Community Lead")')).toBeVisible();
    
    await roleSelect.selectOption('community_lead');
    await formHelper.submitForm();
    
    await expect(page.locator('text=User updated successfully')).toBeVisible();
  });

  test('should enable/disable 2FA for user', async ({ page }) => {
    await navigationHelper.navigateToSection('users');
    
    // Find user and edit
    const userRow = page.locator('tbody tr').first();
    await userRow.locator('button:has-text("Edit")').click();
    
    await modalHelper.waitForModal();
    
    // Check for 2FA settings
    const twoFACheckbox = page.locator('input[type="checkbox"][name*="2fa"], input[type="checkbox"][name*="mfa"]');
    if (await twoFACheckbox.isVisible()) {
      await twoFACheckbox.check();
      await formHelper.submitForm();
      await expect(page.locator('text=User updated successfully')).toBeVisible();
    }
  });

  test('should reset user password', async ({ page }) => {
    await navigationHelper.navigateToSection('users');
    
    // Find user and access password reset
    const userRow = page.locator('tbody tr').first();
    const actionsButton = userRow.locator('button:has-text("Actions"), button:has-text("More")');
    
    if (await actionsButton.isVisible()) {
      await actionsButton.click();
      
      const resetPasswordButton = page.locator('button:has-text("Reset Password")');
      if (await resetPasswordButton.isVisible()) {
        await resetPasswordButton.click();
        
        await modalHelper.waitForModal();
        
        // Fill new password
        await page.fill('input[name="new_password"]', 'newpass123');
        await page.fill('input[name="confirm_password"]', 'newpass123');
        
        await formHelper.submitForm();
        await expect(page.locator('text=Password reset successfully')).toBeVisible();
      }
    }
  });

  test('should block/unblock user', async ({ page }) => {
    await navigationHelper.navigateToSection('users');
    
    // Find user to block
    const userRow = page.locator('tbody tr').first();
    const username = await userRow.locator('td').first().textContent();
    
    // Block user
    const actionsButton = userRow.locator('button:has-text("Actions"), button:has-text("Block")');
    await actionsButton.click();
    
    const blockButton = page.locator('button:has-text("Block")');
    if (await blockButton.isVisible()) {
      await blockButton.click();
    }
    
    // Confirm blocking
    await modalHelper.confirmAction();
    
    // Should show blocked status
    await expect(page.locator(`text=${username}`).locator('..').locator('text=Blocked')).toBeVisible();
  });

  test('should view user activity history', async ({ page }) => {
    await navigationHelper.navigateToSection('users');
    
    // Find user and view activity
    const userRow = page.locator('tbody tr').first();
    const viewButton = userRow.locator('button:has-text("View"), a:has-text("Activity")');
    
    if (await viewButton.isVisible()) {
      await viewButton.click();
      
      // Should show activity page or modal
      await expect(page.locator('text=Activity History, text=User Activity')).toBeVisible();
      
      // Should show activity entries
      await expect(page.locator('text=Login, text=Action, text=Timestamp').first()).toBeVisible();
    }
  });

  test('should export users data', async ({ page }) => {
    await navigationHelper.navigateToSection('users');
    
    // Look for export button
    const exportButton = page.locator('button:has-text("Export"), button:has-text("Download")');
    if (await exportButton.isVisible()) {
      // Set up download handler
      const downloadPromise = page.waitForEvent('download');
      await exportButton.click();
      
      const download = await downloadPromise;
      
      // Should download a file
      expect(download.suggestedFilename()).toContain('users');
    }
  });

  test('should filter users by role', async ({ page }) => {
    await navigationHelper.navigateToSection('users');
    
    // Check for role filter
    const roleFilter = page.locator('select[name="role_filter"], select:has-text("Role")');
    if (await roleFilter.isVisible()) {
      await roleFilter.selectOption('community_lead');
      await page.waitForTimeout(500); // Wait for filter to apply
      
      // Should show filtered results
      const userRows = page.locator('tbody tr');
      await expect(userRows.first()).toBeVisible();
    }
  });

  test('should search users', async ({ page }) => {
    await navigationHelper.navigateToSection('users');
    
    // Check for search functionality
    const searchInput = page.locator('input[placeholder*="Search"], input[name="search"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill('test');
      await page.waitForTimeout(500); // Wait for search results
      
      // Should filter results
      const searchResults = page.locator('tbody tr');
      await expect(searchResults.first()).toBeVisible();
    }
  });

  test('should delete user using correct flow', async ({ page }) => {
    // First create a test user to delete
    await navigationHelper.navigateToSection('users');
    await page.click('button:has-text("Create User")');
    
    await modalHelper.waitForModal();
    
    const testUserData = {
      username: `deleteme_${generateTestData.randomString()}`,
      email: generateTestData.randomEmail(),
      password: 'testpass123',
      full_name: 'Delete Me User',
      role: 'user'
    };
    
    await formHelper.fillForm(testUserData);
    
    const orgSelect = page.locator('select[name="organization_id"]');
    if (await orgSelect.isVisible()) {
      await orgSelect.selectOption({ index: 1 });
    }
    
    await formHelper.submitForm();
    await expect(page.locator('text=User created successfully')).toBeVisible();
    
    // Now delete the user using the corrected delete flow: Edit -> Red X -> Delete
    await deleteHelper.performDelete(`tbody tr:has-text("${testUserData.username}")`, testUserData.username);
    
    // Verify user is deleted
    await expect(page.locator(`text=${testUserData.username}`)).not.toBeVisible();
  });

  test('should show user activity and last login', async ({ page }) => {
    await navigationHelper.navigateToSection('users');
    
    // Check that last login column shows data
    await expect(page.locator('th:has-text("Last Login")')).toBeVisible();
    
    // Should show actual dates or 'Never' for new users
    const lastLoginCells = page.locator('td').filter({ hasText: /Never|2024|2025|\d{2}\/\d{2}\/\d{4}/ });
    await expect(lastLoginCells.first()).toBeVisible();
  });
});
