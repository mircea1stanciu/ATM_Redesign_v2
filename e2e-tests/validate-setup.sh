#!/bin/bash

echo "🚀 UnifiedWork E2E Testing Setup Validation"
echo "==========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to check if a port is open
check_port() {
    local port=$1
    local service=$2
    
    if nc -z localhost $port 2>/dev/null; then
        echo -e "${GREEN}✅ $service (port $port) is running${NC}"
        return 0
    else
        echo -e "${RED}❌ $service (port $port) is not running${NC}"
        return 1
    fi
}

# Check prerequisites
echo -e "\n${BLUE}🔍 Checking Prerequisites...${NC}"

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✅ Node.js $NODE_VERSION installed${NC}"
else
    echo -e "${RED}❌ Node.js is not installed${NC}"
    exit 1
fi

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ package.json not found. Please run this script from the e2e-tests directory${NC}"
    exit 1
fi

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}⚠️  Node modules not found. Installing dependencies...${NC}"
    npm install
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Failed to install dependencies${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ Dependencies installed${NC}"
else
    echo -e "${GREEN}✅ Dependencies are installed${NC}"
fi

# Check environment file
if [ -f ".env" ]; then
    echo -e "${GREEN}✅ Environment file (.env) exists${NC}"
else
    echo -e "${YELLOW}⚠️  .env file not found. Using default values.${NC}"
fi

# Check server status
echo -e "\n${BLUE}🌐 Checking Server Status...${NC}"

FRONTEND_RUNNING=false
BACKEND_RUNNING=false

if check_port 3003 "Frontend Server"; then
    FRONTEND_RUNNING=true
fi

if check_port 8002 "Backend Server"; then
    BACKEND_RUNNING=true
fi

# Provide guidance if servers are not running
if [ "$FRONTEND_RUNNING" = false ] || [ "$BACKEND_RUNNING" = false ]; then
    echo -e "\n${YELLOW}📋 Server Startup Instructions:${NC}"
    
    if [ "$FRONTEND_RUNNING" = false ]; then
        echo -e "${YELLOW}   Frontend: cd ../frontend && npm start (or npm run dev)${NC}"
    fi
    
    if [ "$BACKEND_RUNNING" = false ]; then
        echo -e "${YELLOW}   Backend: cd ../backend && uvicorn main:app --reload --port 8002${NC}"
    fi
    
    echo -e "\n${YELLOW}💡 Tip: You can also use the webServer configuration in playwright.config.ts${NC}"
    echo -e "${YELLOW}   This will automatically start servers when running tests.${NC}"
fi

# Run a basic test if servers are running
if [ "$FRONTEND_RUNNING" = true ] && [ "$BACKEND_RUNNING" = true ]; then
    echo -e "\n${BLUE}🧪 Running Basic Authentication Test...${NC}"
    
    # Run just the authentication test
    npx playwright test 01-authentication.spec.ts --project=chromium --reporter=line
    
    if [ $? -eq 0 ]; then
        echo -e "\n${GREEN}🎉 Basic test passed! Your setup is working correctly.${NC}"
    else
        echo -e "\n${YELLOW}⚠️  Basic test failed. This might be due to:${NC}"
        echo -e "${YELLOW}   - Test user credentials not matching your database${NC}"
        echo -e "${YELLOW}   - Application not fully loaded${NC}"
        echo -e "${YELLOW}   - UI changes affecting test selectors${NC}"
        echo -e "\n${YELLOW}💡 Check the test output above and update your .env file if needed.${NC}"
    fi
else
    echo -e "\n${YELLOW}⏭️  Skipping test run - servers are not running${NC}"
fi

# Summary and next steps
echo -e "\n${BLUE}📋 Summary and Next Steps:${NC}"
echo "----------------------------------------"

if [ "$FRONTEND_RUNNING" = true ] && [ "$BACKEND_RUNNING" = true ]; then
    echo -e "${GREEN}✅ Both servers are running - you're ready to run tests!${NC}"
    echo ""
    echo -e "${BLUE}🚀 Quick Commands:${NC}"
    echo "   npm test                    # Run all tests"
    echo "   npm run test:ui             # Run with interactive UI"
    echo "   npm run test:headed         # Run with visible browser"
    echo "   npx playwright test --help  # See all options"
    echo ""
    echo -e "${BLUE}📊 View Results:${NC}"
    echo "   npm run test:report         # Open HTML report"
else
    echo -e "${YELLOW}⚠️  Start both servers first, then run tests${NC}"
    echo ""
    echo -e "${BLUE}🔧 Setup Steps:${NC}"
    echo "   1. Start frontend server on port 3003"
    echo "   2. Start backend server on port 8002"
    echo "   3. Update .env with your test user credentials"
    echo "   4. Run: npm test"
fi

echo ""
echo -e "${BLUE}📚 Documentation:${NC}"
echo "   README.md                   # Full testing guide"
echo "   tests/utils/test-helpers.ts # Test utilities reference"
echo ""
echo -e "${GREEN}Happy Testing! 🎯${NC}"
