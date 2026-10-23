# Video & Screenshot Capture Documentation

## 📹 Video Recording Configuration

The Playwright E2E tests are now configured to capture videos for all test scenarios, including both successes and failures.

### Video Configuration

Videos are configured in `playwright.config.ts`:

```typescript
use: {
  baseURL: process.env.BASE_URL || 'http://localhost:3003',
  trace: 'on-first-retry',
  screenshot: 'only-on-failure',
  video: 'retain-on-failure', // Change to 'always' to record all tests
}
```

### Video Retention Options

- **`'always'`** - Record video for every test run
- **`'retain-on-failure'`** - Only keep videos when tests fail (default)
- **`'off'`** - Don't record videos

To enable videos for all tests (including successes):

```bash
# Change playwright.config.ts video option to 'always'
# OR use environment variable
PLAYWRIGHT_VIDEO=always npm test
```

## 📸 Screenshots for Success Messages

All authentication tests now capture screenshots of successful login screens. These are stored in `test-results/screenshots/`.

### Screenshot Capture Helper

The `takeVideoScreenshot()` helper function captures screenshots with descriptions:

```typescript
import { takeVideoScreenshot } from './utils/test-helpers';

// In your test:
await takeVideoScreenshot(page, 'login-success', 'User successfully logged in');
```

### Success Screenshots Added

1. **`super-admin-login-*.png`** - Super admin dashboard after login
2. **`org-admin-login-*.png`** - Organization admin dashboard
3. **`regular-user-login-*.png`** - Regular user dashboard
4. **`logout-success-*.png`** - Login page after logout
5. **`session-refresh-success-*.png`** - Dashboard after session refresh

## 📂 Output Locations

Videos and screenshots are stored in:

```
test-results/
├── screenshots/           # Screenshots for success messages
│   ├── super-admin-login-*.png
│   ├── org-admin-login-*.png
│   ├── regular-user-login-*.png
│   ├── logout-success-*.png
│   └── session-refresh-success-*.png
├── results.json          # Test results in JSON format
└── videos/               # Video recordings (if enabled)
    ├── 01-authentication-should-login-as-super-admin-successfully-*.webm
    ├── 01-authentication-should-logout-successfully-*.webm
    └── ...
```

## 🎬 Recording All Tests

To enable video recording for all tests (including passing ones):

### Option 1: Update Configuration File

Edit `playwright.config.ts`:

```typescript
use: {
  // ... other config
  video: 'always', // Record all tests
}
```

### Option 2: Environment Variable

```bash
PLAYWRIGHT_VIDEO=always npm test
```

### Option 3: Command Line

```bash
npx playwright test --headed --record-video=all
```

## 📊 View Test Reports with Videos

After running tests, view the HTML report with embedded videos:

```bash
npm run test:report
```

Or open directly:

```bash
npx playwright show-report
```

The HTML report will include:
- ✅ Test results and duration
- 📹 Video recordings (if enabled)
- 📸 Screenshots on failure
- 🔍 Traces for debugging
- 📝 Console logs

## 🎯 Best Practices

1. **Development**: Record videos for all tests
   ```bash
   PLAYWRIGHT_VIDEO=always npm run test:ui
   ```

2. **CI/CD**: Record videos only on failures
   ```bash
   npm test  # Uses 'retain-on-failure' from config
   ```

3. **Debugging**: Use traces and videos together
   ```bash
   npm run test:debug
   ```

4. **Screenshots**: Always captured for success messages in auth tests

## 💾 Storage Considerations

Video files are large (typically 1-5 MB per test):

- **Videos for all tests**: ~100-500 MB per test run
- **Videos for failures only**: ~5-50 MB per test run
- **Screenshots**: ~50-200 KB each

### Cleanup Old Videos

```bash
# Remove test results folder
rm -rf test-results/

# Or keep only recent results
find test-results -name "*.webm" -mtime +7 -delete
```

## 🔧 Advanced Configuration

### Custom Video Size

```typescript
use: {
  video: {
    size: { width: 1920, height: 1080 }
  }
}
```

### Screenshot Quality

```typescript
use: {
  screenshot: 'only-on-failure'
  // File path is customizable in takeScreenshot()
}
```

## 📋 Example Test with Video Capture

```typescript
import { test, expect } from '@playwright/test';
import { AuthHelper, testUsers, takeVideoScreenshot } from './utils/test-helpers';

test('should login as super admin successfully', async ({ page }) => {
  const authHelper = new AuthHelper(page);
  
  // Perform login
  await authHelper.login(testUsers.superAdmin);
  
  // Verify success
  await expect(page).toHaveURL(/\/(admin|dashboard)/);
  
  // Capture screenshot of success state
  await takeVideoScreenshot(page, 'login-success', 'Admin logged in successfully');
});
```

## 🎥 Recommended Setup

For optimal testing and recording:

```bash
# Install playwright browsers
npx playwright install

# Run tests with videos and headed mode for viewing
PLAYWRIGHT_VIDEO=always npm run test:headed

# View results
npm run test:report
```

---

**Note**: Videos and screenshots are automatically attached to the HTML report. You can download them or view them in the browser through the report interface.
