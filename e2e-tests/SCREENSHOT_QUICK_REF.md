# 🎬 Video & Screenshot Quick Reference

## 📸 Capturing Screenshots for Success Messages

### What's Captured Automatically?

Your authentication tests now capture screenshots of:
- ✅ Super admin dashboard after login
- ✅ Organization admin dashboard after login
- ✅ Regular user dashboard after login
- ✅ Login page after logout
- ✅ Dashboard after session refresh

### How to Enable Video Recording

```bash
# Option 1: Environment Variable
PLAYWRIGHT_VIDEO=always npm test

# Option 2: UI Mode with Videos
PLAYWRIGHT_VIDEO=always npm run test:ui

# Option 3: Default (Videos only on failures)
npm test
```

## 📊 View Results

```bash
# Open HTML report with embedded screenshots
npm run test:report
```

## 🎯 Common Commands

| Command | Result |
|---------|--------|
| `npm test` | Run all tests, capture screenshots on success & video on failure |
| `PLAYWRIGHT_VIDEO=always npm test` | Run all tests, record video for every test |
| `npm run test:ui` | Interactive UI mode |
| `npm run test:headed` | Visible browser while running |
| `npm run test:report` | View HTML report with all media |
| `npm run test:debug` | Step-by-step debugging |

## 📂 Where Files Are Stored

```
test-results/
├── screenshots/           ← Success state screenshots
│   ├── super-admin-login-*.png
│   ├── org-admin-login-*.png
│   ├── regular-user-login-*.png
│   ├── logout-success-*.png
│   └── session-refresh-success-*.png
└── videos/               ← Video recordings (if enabled)
    └── *.webm
```

## ✨ Screenshot Features

- **Automatic** - Captured at end of each successful test
- **Timestamped** - Unique timestamp for each file
- **Full Page** - Entire page is captured
- **Console Logged** - Events printed to console

## 🎮 Example Usage

```typescript
// In your test
import { takeVideoScreenshot } from './utils/test-helpers';

test('my login test', async ({ page }) => {
  // ... test code ...
  
  // Capture success screenshot
  await takeVideoScreenshot(page, 'my-success', 'User logged in successfully');
});
```

## 📋 Configuration Options

Edit `playwright.config.ts`:

```typescript
use: {
  video: 'always',           // Always record videos
  // OR
  video: 'retain-on-failure', // Only record on failures (default)
  // OR
  video: 'off',              // Don't record videos
}
```

## 🔍 Troubleshooting

**No screenshots appearing?**
- Check `test-results/screenshots/` folder exists
- Ensure tests are passing
- Check console for "📸 Screenshot:" messages

**Videos not recording?**
- Use `PLAYWRIGHT_VIDEO=always npm test`
- Check `test-results/videos/` folder
- Videos only work in headed or UI mode

**Report not showing media?**
- Run `npm run test:report` after tests complete
- Media is embedded in the HTML report
- May need to refresh browser

## 💾 Storage Notes

| Type | Size | Count |
|------|------|-------|
| Screenshot | 50-200 KB | 5 per auth test |
| Video (all tests) | 1-5 MB | 1 per test |
| Report | 100-500 KB | 1 per run |

## 🚀 Quick Start

```bash
# 1. Run tests with screenshots
npm test

# 2. View results
npm run test:report

# 3. For videos of all tests
PLAYWRIGHT_VIDEO=always npm test
npm run test:report
```

---

**For detailed information, see:**
- `VIDEO_CAPTURE_GUIDE.md` - Complete documentation
- `README.md` - Full testing guide
- `tests/utils/test-helpers.ts` - Implementation details
