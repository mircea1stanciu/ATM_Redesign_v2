#!/bin/bash

# Script to run tests with full screenshot and video capture
# This captures screenshots for ALL tests, not just failures

echo "🎬 Running E2E Tests with Full Screenshot & Video Capture"
echo "=========================================================="

# Create test-results directory if it doesn't exist
mkdir -p test-results/screenshots

# Run tests with capture enabled
echo ""
echo "📸 Running tests with screenshot and video capture..."
echo ""

# Use environment variables to force screenshot capture
PLAYWRIGHT_SCREENSHOT=always npx playwright test "$@"

# Check results
echo ""
echo "=========================================================="
echo "✅ Test run complete!"
echo ""
echo "📂 Results location:"
echo "   - Screenshots: test-results/screenshots/"
echo "   - Videos: test-results/videos/"
echo "   - Report: test-results/playwright-report/"
echo ""
echo "📊 View report:"
echo "   npm run test:report"
echo ""
