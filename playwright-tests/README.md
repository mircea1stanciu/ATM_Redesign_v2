# ATM (Automation Test Manager) - Playwright E2E Tests

Comprehensive end-to-end test suite for the Automation Test Manager application using Playwright.

## 📋 Test Coverage

### 1. **Authentication Tests** (`auth.spec.ts`)
- ✅ Login page display
- ✅ Invalid credentials handling
- ✅ Admin user login
- ✅ Lead user login
- ✅ Logout functionality
- ✅ Form validation
- ✅ Session persistence
- ✅ Protected route redirection

### 2. **Dashboard Tests** (`dashboard.spec.ts`)
- ✅ Dashboard layout and components
- ✅ Project selector
- ✅ Theme toggle (light/dark mode)
- ✅ User profile section
- ✅ GitHub connection status
- ✅ Navigation to different pages
- ✅ Running test indicator

### 3. **Projects Page Tests** (`projects.spec.ts`)
- ✅ Projects page display
- ✅ Create project button
- ✅ Project creation form
- ✅ Search/filter functionality
- ✅ Project list display
- ✅ Project actions (edit, delete)
- ✅ Active project selector
- ✅ Pagination

### 4. **Test Runs Tests** (`test-runs.spec.ts`)
- ✅ Test runs page display
- ✅ Runs table/list display
- ✅ Status badges
- ✅ Run details view
- ✅ Filter and sort options
- ✅ Execution time display
- ✅ Test counts
- ✅ Success/failure rates
- ✅ List refresh

### 5. **Analytics Tests** (`analytics.spec.ts`)
- ✅ Analytics page display
- ✅ Metrics cards
- ✅ Test execution charts
- ✅ Success rate metrics
- ✅ Test trends visualization
- ✅ Date range selection
- ✅ Framework breakdown
- ✅ Filter updates

### 6. **Responsive Design Tests** (`responsive.spec.ts`)
- ✅ Mobile layout (375x667)
- ✅ Tablet layout (768x1024)
- ✅ Desktop layout (1920x1080)
- ✅ Mobile navigation
- ✅ Font size readability
- ✅ Overflow handling
- ✅ Spacing adjustments

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ installed
- Frontend application running on `http://localhost:3000`
- Backend API running on `http://localhost:8000`

### Installation

```bash
cd playwright-tests
npm install
```

### Configuration

Update test users in `tests/fixtures/test-data.ts` with valid credentials:

```typescript
export const testUsers = {
  admin: {
    email: 'admin@test.com',
    password: 'Admin@12345',
  },
  lead: {
    email: 'lead@test.com',
    password: 'Lead@12345',
  },
};
```

## 📝 Running Tests

### Run all tests
```bash
npm test
```

### Run specific test file
```bash
npm test tests/auth.spec.ts
```

### Run tests in UI mode (interactive)
```bash
npm run test:ui
```

### Run tests in headed mode (see browser)
```bash
npm run test:headed
```

### Run tests in debug mode
```bash
npm run test:debug
```

### Run tests in specific browser
```bash
npm run test:chrome      # Chromium only
npm run test:firefox     # Firefox only
npm run test:webkit      # Safari only
```

### Generate HTML report
```bash
npm run report
```

## 🔧 Configuration

Edit `playwright.config.ts` to customize:

- **Base URL**: Change `baseURL` for different environments
- **Browsers**: Add/remove browsers in `projects` array
- **Timeout**: Adjust test timeout and wait times
- **Screenshots**: Enable/disable screenshots on failure
- **Videos**: Enable/disable video recording

## 📊 Test Execution

Tests are configured to:
- Run in **parallel** by default for faster execution
- **Auto-wait** for elements (up to 5 seconds)
- **Retry twice** on CI (continuous integration)
- **Capture screenshots** on failure
- **Record videos** on failure
- **Generate HTML reports** with detailed results
- **Export JUnit XML** for CI/CD integration

## 🎯 Test Architecture

```
tests/
├── fixtures/
│   └── test-data.ts       # Test users, projects, and data
├── utils/
│   └── helpers.ts         # Reusable test helper functions
├── auth.spec.ts           # Authentication tests
├── dashboard.spec.ts      # Dashboard page tests
├── projects.spec.ts       # Projects management tests
├── test-runs.spec.ts      # Test runs display tests
├── analytics.spec.ts      # Analytics page tests
└── responsive.spec.ts     # Responsive design tests
```

## 🔐 Security

- Test credentials are stored in `tests/fixtures/test-data.ts`
- For production testing, use environment variables:
  ```bash
  TEST_USER_EMAIL=user@example.com TEST_USER_PASSWORD=pass npm test
  ```

## 📈 CI/CD Integration

### GitHub Actions Example

```yaml
name: Playwright Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: cd playwright-tests && npm install
      - run: npm test
      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
```

## 🐛 Troubleshooting

### Tests failing to find elements
- Ensure selectors match your HTML structure
- Use `--debug` mode to inspect elements
- Check that application is running on correct URL

### Timeout errors
- Increase timeout in `playwright.config.ts`
- Check network connectivity
- Verify backend is running

### Authentication failures
- Update test credentials in `test-data.ts`
- Ensure users exist in your database
- Check JWT token configuration

## 📚 Best Practices

1. **Use test fixtures** for common setup/teardown
2. **Keep selectors maintainable** - avoid magic strings
3. **Use meaningful test names** that describe what is being tested
4. **Group related tests** using `test.describe()`
5. **Wait for elements** properly - don't use arbitrary delays
6. **Isolate tests** - each test should be independent

## 🔗 Resources

- [Playwright Documentation](https://playwright.dev/)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Selectors Guide](https://playwright.dev/docs/selectors)

## 📝 Notes

- Tests use realistic selectors based on the application UI
- Some tests check for element visibility without strict assertions (flexible approach)
- All tests include proper waits for network and DOM updates
- Tests are designed to be maintainable and easily extended

## ✅ Test Status

| Test Suite | Status | Count |
|-----------|--------|-------|
| Authentication | ✅ Ready | 7 tests |
| Dashboard | ✅ Ready | 10 tests |
| Projects | ✅ Ready | 10 tests |
| Test Runs | ✅ Ready | 10 tests |
| Analytics | ✅ Ready | 11 tests |
| Responsive | ✅ Ready | 9 tests |
| **Total** | **✅ Ready** | **57 tests** |

