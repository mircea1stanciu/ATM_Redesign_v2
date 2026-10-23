# 📸 How to View Captured Screenshots and Videos

## 🎯 What You're Seeing in the Report

The Playwright HTML report shows your test results with the following information:

### Test Results Overview
- **Total Tests**: Number of tests run
- **Passed**: ✅ Green checkmark - tests that passed
- **Failed**: ❌ Red X - tests that failed  
- **Flaky**: ⚠️ Tests that pass and fail intermittently
- **Skipped**: ⏭️ Tests that were skipped

### Viewing Individual Test Details

In the report, click on any test to see:
1. **Test Status** - Pass/Fail indicator
2. **Duration** - How long the test took
3. **Test Steps** - Expandable steps showing what the test did
4. **Attachments** - Screenshots, videos, logs
5. **stdout** - Console output from the test

## 📂 File Locations

After running tests, files are stored in:

```
test-results/
├── playwright-report/          ← HTML Report (open in browser)
│   ├── index.html              ← Main report file
│   ├── data/                   ← Report data
│   └── ... (other report files)
├── screenshots/                ← Success screenshots
│   ├── super-admin-login-*.png
│   ├── org-admin-login-*.png
│   └── ...
├── videos/                     ← Video recordings
│   ├── *.webm files
│   └── ...
└── results.json                ← JSON results for CI/CD
```

## 🚀 How to View Your Results

### Option 1: View HTML Report (Recommended)

```bash
cd e2e-tests
npm run test:report
```

This opens the beautiful Playwright HTML report in your browser showing:
- ✅ All test results
- 📸 Screenshots for failures
- 🎥 Video recordings
- 📝 Console logs
- 🔍 Test steps

### Option 2: Open Report File Directly

```bash
# macOS
open test-results/playwright-report/index.html

# Linux
firefox test-results/playwright-report/index.html

# Windows
start test-results/playwright-report/index.html
```

### Option 3: View Screenshots Manually

```bash
ls -lah test-results/screenshots/
open test-results/screenshots/  # macOS
```

## 📸 Finding Your Success Screenshots

Your success screenshots are saved with descriptive names:

1. **super-admin-login-2025-11-19T11-13-45-123Z.png**
   - Shows: Admin dashboard after super admin login
   - Filename includes: Test name + timestamp

2. **org-admin-login-2025-11-19T11-13-55-456Z.png**
   - Shows: Organization admin dashboard
   - Filename includes: Test name + timestamp

3. **regular-user-login-2025-11-19T11-14-05-789Z.png**
   - Shows: Regular user dashboard
   - Filename includes: Test name + timestamp

4. **logout-success-2025-11-19T11-14-15-012Z.png**
   - Shows: Login page after logout
   - Filename includes: Test name + timestamp

5. **session-refresh-success-2025-11-19T11-14-25-345Z.png**
   - Shows: Dashboard after page refresh
   - Filename includes: Test name + timestamp

## 🎥 Finding Your Videos

Videos are stored in `test-results/videos/` with names like:
- `01-authentication-should-login-as-super-admin-successfully-*.webm`
- Format: TestFile-TestName-UniqueID.webm
- Browser: Chromium, Firefox, or Safari
- Contains: Complete test execution flow

## 📊 Report Features

In the HTML report, you can:

1. **Filter Results**
   - Click tabs: All, Passed, Failed, Flaky, Skipped
   - Use search bar to find specific tests

2. **View Test Steps**
   - Expand "Test Steps" section
   - See each action the test performed
   - Timeline shows when each step occurred

3. **View Attachments**
   - Expand "Attachments" section
   - View or download screenshots
   - Watch embedded videos
   - Read console logs

4. **Analyze Failures**
   - Failed tests show screenshots
   - Videos show exactly what happened
   - Traces help debug issues

## 🔍 Understanding the Attachments

Each test can have attachments:

- **screenshot** - Static image of page state
- **video** - WebM video of test execution
- **trace** - Playwright trace for debugging
- **stdout** - Console log output

## 💡 Tips for Viewing Media

### Viewing Screenshots
- Click thumbnail to view full size
- Right-click to save image
- Zoom in to see details

### Watching Videos
- Click play button to watch
- Videos are full-screen capable
- Shows exact user interactions
- Includes timing information

### Comparing Test Runs
- Screenshots help compare before/after states
- Videos show the exact sequence of events
- Useful for debugging UI changes

## 🎯 Common Viewing Scenarios

### I want to see what happened in test X
```
1. Open test report: npm run test:report
2. Click on test name
3. Expand "Attachments"
4. View screenshots or watch video
```

### I want to see all failed tests
```
1. Open test report: npm run test:report
2. Click "Failed" tab (red X icon)
3. Only failed tests shown
4. Click each to see screenshots/videos
```

### I want to download a screenshot
```
1. Open test report: npm run test:report
2. Navigate to test
3. Click attachments
4. Right-click screenshot → Save As
```

### I want to share test results
```
1. Zip the entire test-results folder:
   tar -czf test-results.tar.gz test-results/

2. Or just share the HTML report:
   All media is embedded in the HTML
```

## ⚙️ Configuring Capture

### To capture more screenshots:
Edit `playwright.config.ts`:
```typescript
screenshot: 'only-on-failure',  // Only on failures
// Change to:
screenshot: 'always',           // All tests
```

### To capture videos for all tests:
```bash
PLAYWRIGHT_VIDEO=on npx playwright test
# or
npm run test:report  # Enable in config first
```

### To disable videos (save space):
Edit `playwright.config.ts`:
```typescript
video: 'off',  // Don't record videos
```

## 🗑️ Cleaning Up Old Results

```bash
# Remove all test results
rm -rf test-results/

# Remove only videos (save space)
rm -rf test-results/videos/

# Keep only recent screenshots (last 7 days)
find test-results/screenshots -mtime +7 -delete
```

## 📞 Troubleshooting

**"I don't see screenshots"**
- Make sure tests passed (success screenshots only in passing tests)
- Check file system permissions
- Verify test-results/ directory exists

**"Videos are too large"**
- Disable videos: Change `video: 'off'` in config
- Or: `rm -rf test-results/videos/`

**"Report won't open"**
- Make sure all test-results/ files exist
- Try: `npm run test:report`
- Or open file directly in browser

**"Can't see embedded videos in report"**
- Ensure videos are in test-results/videos/
- Report must be served over HTTP (not file://)
- Use `npm run test:report` (starts local server)

## ✨ Pro Tips

1. **Share Full Reports**
   - Deploy test-results/ to a web server
   - Share URL with team
   - Everyone can view with same UI

2. **CI/CD Integration**
   - Upload test-results as GitHub artifact
   - View in Actions tab
   - All history preserved

3. **Automated Analysis**
   - Parse results.json for metrics
   - Track pass/fail rates over time
   - Alert on regressions

4. **Video Analysis**
   - Screenshot comparisons
   - Timeline analysis
   - Performance metrics

---

**Your test results are ready to explore!**

Run: `npm run test:report`
