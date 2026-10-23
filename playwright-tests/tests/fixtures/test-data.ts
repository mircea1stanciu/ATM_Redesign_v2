/**
 * Test data fixtures for ATM E2E tests
 */

export const testUsers = {
  admin: {
    email: 'admin@test.com',
    password: 'Admin@12345',
    role: 'admin',
  },
  lead: {
    email: 'lead@test.com',
    password: 'Lead@12345',
    role: 'automation_lead',
  },
  tester: {
    email: 'tester@test.com',
    password: 'Tester@12345',
    role: 'qa_engineer',
  },
};

export const testProjects = {
  sample: {
    name: 'Sample E-commerce App',
    description: 'E2E tests for e-commerce platform',
    repoUrl: 'https://github.com/sample/ecommerce-tests',
    branch: 'main',
  },
  payment: {
    name: 'Payment Processing',
    description: 'Tests for payment gateway',
    repoUrl: 'https://github.com/sample/payment-tests',
    branch: 'develop',
  },
};

export const testSuites = {
  authentication: {
    name: 'Authentication Suite',
    description: 'Login, logout, and session management tests',
    framework: 'pytest',
  },
  apiTests: {
    name: 'API Integration Tests',
    description: 'REST API endpoint validation',
    framework: 'playwright',
  },
};
