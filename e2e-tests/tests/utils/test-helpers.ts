import { Page, expect } from '@playwright/test';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export interface TestUser {
  username: string;
  password: string;
  role: 'super_admin' | 'org_admin' | 'community_lead' | 'user';
  organizationSlug?: string;
}

export const testUsers: Record<string, TestUser> = {
  superAdmin: {
    username: process.env.TEST_SUPER_ADMIN_USERNAME || 'admin',
    password: process.env.TEST_SUPER_ADMIN_PASSWORD || 'admin123',
    role: 'super_admin',
  },
  orgAdmin: {
    username: process.env.TEST_ORG_ADMIN_USERNAME || 'raiffeisen_admin',
    password: process.env.TEST_ORG_ADMIN_PASSWORD || 'admin123',
    role: 'org_admin',
    organizationSlug: process.env.TEST_ORG_SLUG || 'raiffeisen',
  },
  regularUser: {
    username: process.env.TEST_USER_USERNAME || 'john_qa_raiffeisen',
    password: process.env.TEST_USER_PASSWORD || 'admin123',
    role: 'user',
    organizationSlug: process.env.TEST_ORG_SLUG || 'raiffeisen',
  },
};

export class AuthHelper {
  constructor(private page: Page) {}

  async login(user: TestUser) {
    await this.page.goto('/login');
    
    // Wait for login form to be visible
    await expect(this.page.locator('form').or(this.page.locator('input[name="username"]'))).toBeVisible();
    
    // Fill login credentials
    await this.page.fill('input[name="username"], input[placeholder*="username"]', user.username);
    await this.page.fill('input[name="password"], input[placeholder*="password"]', user.password);
    
    // Fill organization slug if provided
    if (user.organizationSlug) {
      const orgSlugInput = this.page.locator('input[name="organization_slug"], input[placeholder*="organization"]');
      if (await orgSlugInput.isVisible()) {
        await orgSlugInput.fill(user.organizationSlug);
      }
    }
    
    // Submit form
    await this.page.click('button[type="submit"], button:has-text("Login"), button:has-text("Sign In")');
    
    // Wait for successful login (redirect to admin or dashboard)
    await expect(this.page).toHaveURL(/\/(admin|dashboard)/);
    
    // Verify user is logged in by checking for admin/dashboard content
    await expect(this.page.locator('h1, h2, nav').first()).toBeVisible({ timeout: 10000 });
  }

  async logout() {
    // Look for logout button or user menu
    const userMenu = this.page.locator('[data-testid="user-menu"]');
    const logoutButton = this.page.locator('button').filter({ hasText: /logout|sign out/i });
    
    if (await userMenu.isVisible()) {
      await userMenu.click();
      await this.page.click('button:has-text("Logout")');
    } else if (await logoutButton.isVisible()) {
      await logoutButton.click();
    }
    
    // Wait for redirect to login page
    await expect(this.page).toHaveURL('/login');
  }

  async ensureLoggedIn(user: TestUser) {
    // Check if already logged in by trying to go to admin or dashboard
    try {
      await this.page.goto('/admin');
      await expect(this.page.locator('h1, h2, nav').first()).toBeVisible({ timeout: 3000 });
    } catch {
      try {
        await this.page.goto('/dashboard');
        await expect(this.page.locator('h1, h2, nav').first()).toBeVisible({ timeout: 3000 });
      } catch {
        // Not logged in, perform login
        await this.login(user);
      }
    }
  }
}

export class NavigationHelper {
  constructor(private page: Page) {}

  async navigateToSection(section: 'overview' | 'organizations' | 'users' | 'api-docs' | 'api-docs-todo') {
    // Look for navigation menu
    const navButton = this.page.locator(`button:has-text("${section.replace('-', ' ')}")`).first();
    const navLink = this.page.locator(`a[href*="${section}"]`).first();
    
    if (await navButton.isVisible()) {
      await navButton.click();
    } else if (await navLink.isVisible()) {
      await navLink.click();
    } else {
      // Try clicking on sidebar navigation
      await this.page.click(`[data-section="${section}"]`);
    }
    
    // Wait for content to load
    await this.page.waitForTimeout(500);
  }

  async openUserMenu() {
    await this.page.click('[data-testid="user-menu"]');
  }
}

export class APIHelper {
  private baseUrl: string;

  constructor(private page: Page) {
    this.baseUrl = process.env.API_BASE_URL || 'http://localhost:8002/api';
  }

  async makeAPICall(endpoint: string, options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    data?: any;
    headers?: Record<string, string>;
  } = {}) {
    const { method = 'GET', data, headers = {} } = options;
    
    // Get auth token from localStorage if available
    const token = await this.page.evaluate(() => localStorage.getItem('access_token'));
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    if (data) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await this.page.request.fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers,
      data: data ? JSON.stringify(data) : undefined,
    });

    return {
      status: response.status(),
      data: await response.json().catch(() => null),
      response
    };
  }

  async getOrganizations() {
    return this.makeAPICall('/organizations');
  }

  async createOrganization(orgData: {
    name: string;
    slug: string;
    admin_email: string;
    admin_username: string;
    admin_password: string;
    subscription_plan?: string;
  }) {
    return this.makeAPICall('/organizations', {
      method: 'POST',
      data: orgData,
    });
  }

  async getUsers(orgId: number) {
    return this.makeAPICall(`/organizations/${orgId}/users`);
  }

  async createUser(orgId: number, userData: {
    username: string;
    email: string;
    password: string;
    full_name: string;
    role: string;
    assigned_communities?: string[];
  }) {
    return this.makeAPICall(`/organizations/${orgId}/users`, {
      method: 'POST',
      data: userData,
    });
  }
}

export class FormHelper {
  constructor(private page: Page) {}

  async fillForm(formData: Record<string, string | string[]>) {
    for (const [field, value] of Object.entries(formData)) {
      const input = this.page.locator(`input[name="${field}"], select[name="${field}"], textarea[name="${field}"]`);
      
      if (Array.isArray(value)) {
        // Handle multi-select or checkbox groups
        for (const val of value) {
          await this.page.check(`input[name="${field}"][value="${val}"]`);
        }
      } else {
        const inputType = await input.getAttribute('type');
        
        if (inputType === 'select' || await input.evaluate(el => el.tagName.toLowerCase() === 'select')) {
          await input.selectOption(value);
        } else {
          await input.fill(value);
        }
      }
    }
  }

  async submitForm(submitSelector = 'button[type="submit"]') {
    await this.page.click(submitSelector);
  }

  async waitForFormSubmission(successSelector?: string) {
    if (successSelector) {
      await expect(this.page.locator(successSelector)).toBeVisible();
    } else {
      // Wait for any success message or redirect
      await this.page.waitForTimeout(1000);
    }
  }
}

export class ModalHelper {
  constructor(private page: Page) {}

  async waitForModal(modalSelector = '[role="dialog"], .modal, [data-testid*="modal"]') {
    await expect(this.page.locator(modalSelector)).toBeVisible();
  }

  async closeModal(closeSelector = 'button[aria-label="Close"], .modal-close, [data-testid="modal-close"]') {
    await this.page.click(closeSelector);
  }

  async confirmAction(confirmSelector = 'button:has-text("Confirm"), button:has-text("Yes"), button:has-text("Delete")') {
    await this.page.click(confirmSelector);
  }
}

export class DeleteHelper {
  constructor(private page: Page) {}

  /**
   * Handles the three-step delete process: Edit -> Red X -> Delete
   * @param itemSelector - Selector for the item row/container to delete
   * @param itemIdentifier - Text to identify the specific item (optional for verification)
   */
  async performDelete(itemSelector: string, itemIdentifier?: string) {
    const itemRow = this.page.locator(itemSelector);
    
    // Step 1: Click Edit button
    const editButton = itemRow.locator('button:has-text("Edit"), button[aria-label="Edit"]');
    await expect(editButton).toBeVisible();
    await editButton.click();
    
    // Wait a moment for the UI to update
    await this.page.waitForTimeout(500);
    
    // Step 2: Click the red X button that appears after edit
    const redXButton = itemRow.locator('button.text-red-600, button[aria-label*="delete"], button:has-text("×"), button:has-text("✕")');
    await expect(redXButton).toBeVisible();
    await redXButton.click();
    
    // Step 3: Click the Delete confirmation button
    const deleteButton = this.page.locator('button:has-text("Delete"), button:has-text("Confirm Delete")');
    await expect(deleteButton).toBeVisible();
    await deleteButton.click();
    
    // Wait for deletion to complete
    await this.page.waitForTimeout(1000);
    
    // Verify item is removed (if identifier provided)
    if (itemIdentifier) {
      await expect(this.page.locator(`text=${itemIdentifier}`)).not.toBeVisible();
    }
  }

  /**
   * Alternative delete method for items with action menus
   */
  async performDeleteWithActionMenu(itemSelector: string, itemIdentifier?: string) {
    const itemRow = this.page.locator(itemSelector);
    
    // Step 1: Click Actions/More button
    const actionsButton = itemRow.locator('button:has-text("Actions"), button:has-text("More"), button[aria-label="Actions"]');
    await expect(actionsButton).toBeVisible();
    await actionsButton.click();
    
    // Step 2: Click Edit from dropdown
    const editOption = this.page.locator('button:has-text("Edit"), a:has-text("Edit")');
    await expect(editOption).toBeVisible();
    await editOption.click();
    
    // Wait for edit mode to activate
    await this.page.waitForTimeout(500);
    
    // Step 3: Click the red X button that appears
    const redXButton = itemRow.locator('button.text-red-600, button[aria-label*="delete"], button:has-text("×")');
    await expect(redXButton).toBeVisible();
    await redXButton.click();
    
    // Step 4: Click the Delete confirmation button
    const deleteButton = this.page.locator('button:has-text("Delete"), button:has-text("Confirm Delete")');
    await expect(deleteButton).toBeVisible();
    await deleteButton.click();
    
    // Wait for deletion to complete
    await this.page.waitForTimeout(1000);
    
    // Verify item is removed (if identifier provided)
    if (itemIdentifier) {
      await expect(this.page.locator(`text=${itemIdentifier}`)).not.toBeVisible();
    }
  }
}

export const waitForPageLoad = async (page: Page) => {
  await page.waitForLoadState('networkidle');
};

export const takeScreenshot = async (page: Page, name: string) => {
  await page.screenshot({ path: `test-results/screenshots/${name}.png`, fullPage: true });
};

export const takeVideoScreenshot = async (page: Page, name: string, description: string = '') => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${name}-${timestamp}.png`;
  
  try {
    // Ensure directory exists
    const fs = await import('fs');
    const path = await import('path');
    const screenshotDir = path.join(process.cwd(), 'test-results', 'screenshots');
    
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    
    const filepath = path.join(screenshotDir, filename);
    await page.screenshot({ path: filepath, fullPage: true });
    
    if (description) {
      console.log(`📸 Screenshot: ${description} - ${filename}`);
    }
    
    return filename;
  } catch (error) {
    console.error(`❌ Failed to capture screenshot: ${error}`);
    return filename;
  }
};

export const generateTestData = {
  randomString: (length = 8) => Math.random().toString(36).substring(2, 2 + length),
  randomEmail: () => `test${Date.now()}@example.com`,
  randomUsername: () => `user_${Date.now()}`,
  randomOrgName: () => `Test Org ${Date.now()}`,
  randomOrgSlug: () => `test-org-${Date.now()}`,
};
