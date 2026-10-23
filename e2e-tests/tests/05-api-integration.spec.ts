import { test, expect } from '@playwright/test';
import { 
  AuthHelper, 
  APIHelper, 
  testUsers, 
  generateTestData, 
  waitForPageLoad 
} from './utils/test-helpers';

test.describe('API Integration Tests', () => {
  let authHelper: AuthHelper;
  let apiHelper: APIHelper;

  test.beforeEach(async ({ page }) => {
    authHelper = new AuthHelper(page);
    apiHelper = new APIHelper(page);
    
    // Login to get authentication token
    await authHelper.login(testUsers.superAdmin);
    await waitForPageLoad(page);
  });

  test.describe('Authentication API', () => {
    test('should authenticate with valid credentials', async ({ page }) => {
      // Test direct API login
      const response = await apiHelper.makeAPICall('/auth/login', {
        method: 'POST',
        data: {
          username: testUsers.superAdmin.username,
          password: testUsers.superAdmin.password
        }
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('access_token');
      expect(response.data).toHaveProperty('user');
    });

    test('should reject invalid credentials', async ({ page }) => {
      const response = await apiHelper.makeAPICall('/auth/login', {
        method: 'POST',
        data: {
          username: 'invalid_user',
          password: 'wrong_password'
        }
      });

      expect(response.status).toBe(401);
      expect(response.data).toHaveProperty('error');
    });

    test('should refresh authentication token', async ({ page }) => {
      const response = await apiHelper.makeAPICall('/auth/refresh', {
        method: 'POST'
      });

      // Should either succeed or require new login
      expect([200, 401]).toContain(response.status);
    });

    test('should logout successfully', async ({ page }) => {
      const response = await apiHelper.makeAPICall('/auth/logout', {
        method: 'POST'
      });

      expect([200, 204]).toContain(response.status);
    });
  });

  test.describe('Organizations API', () => {
    test('should get organizations list', async ({ page }) => {
      const response = await apiHelper.getOrganizations();

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
      
      if (response.data.length > 0) {
        expect(response.data[0]).toHaveProperty('id');
        expect(response.data[0]).toHaveProperty('name');
        expect(response.data[0]).toHaveProperty('slug');
      }
    });

    test('should create new organization', async ({ page }) => {
      const orgData = {
        name: generateTestData.randomOrgName(),
        slug: generateTestData.randomOrgSlug(),
        admin_email: generateTestData.randomEmail(),
        admin_username: generateTestData.randomUsername(),
        admin_password: 'admin123',
        subscription_plan: 'basic'
      };

      const response = await apiHelper.createOrganization(orgData);

      expect(response.status).toBe(201);
      expect(response.data).toHaveProperty('id');
      expect(response.data.name).toBe(orgData.name);
      expect(response.data.slug).toBe(orgData.slug);
    });

    test('should get organization details', async ({ page }) => {
      // First get organizations to get a valid ID
      const orgsResponse = await apiHelper.getOrganizations();
      expect(orgsResponse.status).toBe(200);
      
      if (orgsResponse.data.length > 0) {
        const orgId = orgsResponse.data[0].id;
        
        const response = await apiHelper.makeAPICall(`/organizations/${orgId}`, {
          method: 'GET'
        });

        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty('id', orgId);
        expect(response.data).toHaveProperty('name');
        expect(response.data).toHaveProperty('slug');
      }
    });

    test('should update organization', async ({ page }) => {
      const orgsResponse = await apiHelper.getOrganizations();
      
      if (orgsResponse.data.length > 0) {
        const orgId = orgsResponse.data[0].id;
        const updatedData = {
          name: `Updated ${generateTestData.randomOrgName()}`
        };

        const response = await apiHelper.makeAPICall(`/organizations/${orgId}`, {
          method: 'PATCH',
          data: updatedData
        });

        expect([200, 204]).toContain(response.status);
      }
    });

    test('should handle organization not found', async ({ page }) => {
      const response = await apiHelper.makeAPICall('/organizations/99999', {
        method: 'GET'
      });

      expect(response.status).toBe(404);
    });
  });

  test.describe('Users API', () => {
    test('should get organization users', async ({ page }) => {
      const orgsResponse = await apiHelper.getOrganizations();
      
      if (orgsResponse.data.length > 0) {
        const orgId = orgsResponse.data[0].id;
        const response = await apiHelper.getUsers(orgId);

        expect(response.status).toBe(200);
        expect(Array.isArray(response.data)).toBe(true);
        
        if (response.data.length > 0) {
          expect(response.data[0]).toHaveProperty('id');
          expect(response.data[0]).toHaveProperty('username');
          expect(response.data[0]).toHaveProperty('email');
        }
      }
    });

    test('should create new user', async ({ page }) => {
      const orgsResponse = await apiHelper.getOrganizations();
      
      if (orgsResponse.data.length > 0) {
        const orgId = orgsResponse.data[0].id;
        const userData = {
          username: generateTestData.randomUsername(),
          email: generateTestData.randomEmail(),
          password: 'testpass123',
          full_name: 'Test User',
          role: 'user'
        };

        const response = await apiHelper.createUser(orgId, userData);

        expect(response.status).toBe(201);
        expect(response.data).toHaveProperty('id');
        expect(response.data.username).toBe(userData.username);
        expect(response.data.email).toBe(userData.email);
      }
    });

    test('should get user details', async ({ page }) => {
      const orgsResponse = await apiHelper.getOrganizations();
      
      if (orgsResponse.data.length > 0) {
        const orgId = orgsResponse.data[0].id;
        const usersResponse = await apiHelper.getUsers(orgId);
        
        if (usersResponse.data.length > 0) {
          const userId = usersResponse.data[0].id;
          
          const response = await apiHelper.makeAPICall(`/users/${userId}`, {
            method: 'GET'
          });

          expect(response.status).toBe(200);
          expect(response.data).toHaveProperty('id', userId);
          expect(response.data).toHaveProperty('username');
          expect(response.data).toHaveProperty('email');
        }
      }
    });

    test('should update user', async ({ page }) => {
      const orgsResponse = await apiHelper.getOrganizations();
      
      if (orgsResponse.data.length > 0) {
        const orgId = orgsResponse.data[0].id;
        const usersResponse = await apiHelper.getUsers(orgId);
        
        if (usersResponse.data.length > 0) {
          const userId = usersResponse.data[0].id;
          const updatedData = {
            full_name: `Updated ${generateTestData.randomString()}`
          };

          const response = await apiHelper.makeAPICall(`/users/${userId}`, {
            method: 'PATCH',
            data: updatedData
          });

          expect([200, 204]).toContain(response.status);
        }
      }
    });

    test('should handle invalid user data', async ({ page }) => {
      const orgsResponse = await apiHelper.getOrganizations();
      
      if (orgsResponse.data.length > 0) {
        const orgId = orgsResponse.data[0].id;
        const invalidUserData = {
          username: '', // Empty username should fail
          email: 'invalid-email', // Invalid email format
          password: '123', // Password too short
          full_name: 'Test User',
          role: 'user'
        };

        const response = await apiHelper.createUser(orgId, invalidUserData);

        expect(response.status).toBe(400);
        expect(response.data).toHaveProperty('errors');
      }
    });
  });

  test.describe('Error Handling', () => {
    test('should handle unauthorized access', async ({ page }) => {
      // Make request without authentication
      const response = await page.request.fetch(`${process.env.API_BASE_URL || 'http://localhost:8002/api'}/organizations`, {
        method: 'GET'
      });

      expect(response.status()).toBe(401);
    });

    test('should handle invalid endpoints', async ({ page }) => {
      const response = await apiHelper.makeAPICall('/invalid-endpoint', {
        method: 'GET'
      });

      expect(response.status).toBe(404);
    });

    test('should handle malformed requests', async ({ page }) => {
      const response = await page.request.fetch(`${process.env.API_BASE_URL || 'http://localhost:8002/api'}/organizations`, {
        method: 'POST',
        data: 'invalid-json',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await page.evaluate(() => localStorage.getItem('access_token'))}`
        }
      });

      expect(response.status()).toBe(400);
    });

    test('should handle rate limiting gracefully', async ({ page }) => {
      // Make multiple rapid requests to test rate limiting
      const requests = [];
      for (let i = 0; i < 10; i++) {
        requests.push(apiHelper.makeAPICall('/organizations', { method: 'GET' }));
      }

      const responses = await Promise.all(requests);
      
      // At least some requests should succeed
      const successfulRequests = responses.filter(r => r.status === 200);
      expect(successfulRequests.length).toBeGreaterThan(0);
      
      // Check if rate limiting is implemented (would return 429)
      const rateLimitedRequests = responses.filter(r => r.status === 429);
      // This is optional - rate limiting might not be implemented
    });
  });

  test.describe('Data Validation', () => {
    test('should validate required fields', async ({ page }) => {
      const response = await apiHelper.makeAPICall('/organizations', {
        method: 'POST',
        data: {} // Empty data should trigger validation errors
      });

      expect(response.status).toBe(400);
      expect(response.data).toHaveProperty('errors');
    });

    test('should validate data types', async ({ page }) => {
      const response = await apiHelper.makeAPICall('/organizations', {
        method: 'POST',
        data: {
          name: 123, // Should be string
          slug: true, // Should be string
          admin_email: null // Should be string
        }
      });

      expect(response.status).toBe(400);
    });

    test('should validate email format', async ({ page }) => {
      const orgsResponse = await apiHelper.getOrganizations();
      
      if (orgsResponse.data.length > 0) {
        const orgId = orgsResponse.data[0].id;
        const response = await apiHelper.createUser(orgId, {
          username: generateTestData.randomUsername(),
          email: 'invalid-email-format',
          password: 'testpass123',
          full_name: 'Test User',
          role: 'user'
        });

        expect(response.status).toBe(400);
        expect(response.data.errors).toContain('email');
      }
    });

    test('should validate unique constraints', async ({ page }) => {
      const orgsResponse = await apiHelper.getOrganizations();
      
      if (orgsResponse.data.length > 0) {
        const orgId = orgsResponse.data[0].id;
        const usersResponse = await apiHelper.getUsers(orgId);
        
        if (usersResponse.data.length > 0) {
          const existingUser = usersResponse.data[0];
          
          // Try to create user with same username
          const response = await apiHelper.createUser(orgId, {
            username: existingUser.username,
            email: generateTestData.randomEmail(),
            password: 'testpass123',
            full_name: 'Duplicate User',
            role: 'user'
          });

          expect(response.status).toBe(400);
          expect(response.data.errors).toContain('username');
        }
      }
    });
  });

  test.describe('Pagination and Filtering', () => {
    test('should handle pagination parameters', async ({ page }) => {
      const response = await apiHelper.makeAPICall('/organizations?page=1&limit=5', {
        method: 'GET'
      });

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
      // Should return pagination metadata
      expect(response.data.length).toBeLessThanOrEqual(5);
    });

    test('should filter by status', async ({ page }) => {
      const response = await apiHelper.makeAPICall('/organizations?status=active', {
        method: 'GET'
      });

      expect(response.status).toBe(200);
      
      if (response.data.length > 0) {
        // All returned orgs should have active status
        response.data.forEach((org: any) => {
          expect(org.status).toBe('active');
        });
      }
    });

    test('should search by name', async ({ page }) => {
      const response = await apiHelper.makeAPICall('/organizations?search=test', {
        method: 'GET'
      });

      expect(response.status).toBe(200);
      // Should return organizations matching search criteria
    });
  });
});
