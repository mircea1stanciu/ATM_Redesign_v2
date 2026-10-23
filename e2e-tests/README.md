# E2E Testing for UnifiedWork

This directory contains comprehensive end-to-end tests for the UnifiedWork application using Playwright.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ installed
- UnifiedWork application running on localhost:3003 (frontend) and localhost:8002 (backend)

### Installation
```bash
npm install
npx playwright install
```

### Configuration
1. Copy `.env.example` to `.env`
2. Update test user credentials in `.env` file
3. Ensure test users exist in your database

### Running Tests

```bash
# Run all tests
npm test

# Run specific test suite
npx playwright test 01-authentication

# Run tests with UI
npm run test:ui

# Run tests in headed mode (see browser)
npm run test:headed

# Debug tests
npm run test:debug

# View test report
npm run test:report
```

## 📋 Test Coverage

### 1. Authentication Tests (`01-authentication.spec.ts`)
- ✅ Login page display and validation
- ✅ Super admin, org admin, and regular user login flows
- ✅ Invalid credential handling
- ✅ Organization slug validation
- ✅ Logout functionality
- ✅ Session persistence
- ✅ Protected route redirection

### 2. Organization Management (`02-organization-management.spec.ts`)
- ✅ Organization listing and display
- ✅ Organization creation and editing
- ✅ Subscription plan management
- ✅ Organization blocking/unblocking
- ✅ User management for organizations
- ✅ Organization deletion (Edit → Red X → Delete flow)
- ✅ Search and filtering

### 3. User Management (`03-user-management.spec.ts`)
- ✅ User listing and display
- ✅ User creation and editing
- ✅ Role assignment and management
- ✅ Community assignment
- ✅ 2FA enable/disable
- ✅ Password reset functionality
- ✅ User blocking/unblocking
- ✅ User deletion (Edit → Red X → Delete flow)
- ✅ Activity history tracking
- ✅ User export functionality

### 4. API Documentation (`04-api-documentation.spec.ts`)
- ✅ Documentation page display
- ✅ Authentication endpoint documentation
- ✅ Organization endpoint documentation
- ✅ User endpoint documentation
- ✅ HTTP method styling and organization
- ✅ Request/response examples
- ✅ Error code documentation
- ✅ Interactive API testing
- ✅ Search functionality

### 5. API Integration (`05-api-integration.spec.ts`)
- ✅ Authentication API testing
- ✅ Organization CRUD operations
- ✅ User CRUD operations
- ✅ Error handling and validation
- ✅ Data validation and constraints
- ✅ Pagination and filtering
- ✅ Rate limiting testing
- ✅ Unauthorized access handling

## 🔧 Test Helpers

### AuthHelper
Handles login, logout, and session management for different user types.

### NavigationHelper
Manages navigation between different sections of the admin interface.

### FormHelper
Provides utilities for filling and submitting forms.

### ModalHelper
Handles modal dialog interactions and confirmations.

### DeleteHelper
**NEW**: Implements the correct 3-step delete process:
1. Click "Edit" button
2. Click red "X" button that appears
3. Click "Delete" confirmation button

### APIHelper
Direct API testing utilities for backend integration tests.

## 🏗️ Configuration

### Playwright Config (`playwright.config.ts`)
- Multi-browser testing (Chrome, Firefox, Safari, Mobile)
- Automatic server startup
- Parallel test execution
- Screenshot and video capture on failures
- HTML reporting

### Environment Variables (`.env`)
```bash
BASE_URL=http://localhost:3003
API_BASE_URL=http://localhost:8002/api
TEST_SUPER_ADMIN_USERNAME=admin
TEST_SUPER_ADMIN_PASSWORD=admin123
TEST_ORG_ADMIN_USERNAME=raiffeisen_admin
TEST_ORG_ADMIN_PASSWORD=admin123
TEST_USER_USERNAME=john_qa_raiffeisen
TEST_USER_PASSWORD=admin123
TEST_ORG_SLUG=raiffeisen
```

## 📊 Reporting

Tests generate comprehensive reports including:
- HTML reports with screenshots
- Video recordings of failed tests
- Execution traces for debugging
- JSON results for CI/CD integration
- **📹 Success message screenshots** for all authentication tests

## 🚦 CI/CD Integration

Use the provided GitHub Actions workflow (`.github-workflow-example.yml`):

```bash
cp .github-workflow-example.yml .github/workflows/e2e-tests.yml
```

## 🛠️ Troubleshooting

### Common Issues

1. **Server not running**: Ensure both frontend (3003) and backend (8002) are running
2. **Test user credentials**: Update `.env` with valid test user credentials
3. **Database state**: Ensure test users exist in your database
4. **Port conflicts**: Check that test ports are available

### Delete Operation Issues
If delete tests fail, verify the UI follows this flow:
1. Edit button must be clicked first
2. Red X button appears after entering edit mode
3. Delete confirmation button finalizes the action

### Video & Screenshot Guide
For details on capturing videos and screenshots:
- See `VIDEO_CAPTURE_GUIDE.md` for complete video recording documentation
- Screenshots of success messages are automatically captured in auth tests
- Enable video for all tests with: `PLAYWRIGHT_VIDEO=always npm test`

### Debug Mode
```bash
npm run test:debug
```
Opens Playwright Inspector for step-by-step debugging.

### Validation Script
```bash
./validate-setup.sh
```
Checks server availability and runs basic tests.

## 📁 Project Structure

```
e2e-tests/
├── tests/
│   ├── utils/
│   │   └── test-helpers.ts     # Test utilities and helpers
│   ├── 01-authentication.spec.ts
│   ├── 02-organization-management.spec.ts
│   ├── 03-user-management.spec.ts
│   ├── 04-api-documentation.spec.ts
│   └── 05-api-integration.spec.ts
├── playwright.config.ts       # Playwright configuration
├── package.json               # Dependencies and scripts
├── tsconfig.json             # TypeScript configuration
├── .env                      # Environment variables
└── README.md                 # This file
```

## 🎯 Best Practices

1. **Test Isolation**: Each test is independent and can run in any order
2. **Data Generation**: Use `generateTestData` utilities for unique test data
3. **Error Handling**: Tests include proper error scenarios and edge cases
4. **Cross-browser**: Tests run across multiple browsers automatically
5. **Maintainable**: Helper classes keep tests DRY and maintainable

## 🔄 Updating Tests

When adding new features:
1. Add test cases to appropriate spec files
2. Update test helpers if new interactions are needed
3. Update this README with new test coverage
4. Ensure new tests follow existing patterns

## 📈 Performance

Tests are optimized for:
- Parallel execution across test files
- Efficient page load waiting
- Minimal test data generation
- Smart element waiting strategies

---

For questions or issues, refer to the main UnifiedWork documentation or create an issue in the project repository.
