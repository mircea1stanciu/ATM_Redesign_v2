"""
QA Tools for the QA Automation Agent
LangChain tools for test generation, review, and debugging
"""


from langchain.tools import tool


@tool
def generate_playwright_test(description: str) -> str:
    """Generate a Playwright test based on description.
    
    Args:
        description: Description of what the test should do
        
    Returns:
        Generated Playwright test code
    """
    # This is a simplified version - in production, this would use LLM
    template = f"""
import {{ test, expect }} from '@playwright/test';

test('{description}', async ({{ page }}) => {{
  // Navigate to the application
  await page.goto('https://example.com');
  
  // Add test steps based on description: {description}
  // TODO: Implement specific test steps
  
  // Add assertions
  await expect(page).toHaveTitle(/Expected Title/);
}});
"""
    return template.strip()


@tool
def review_test_code(code: str) -> str:
    """Review test code and provide improvement suggestions.
    
    Args:
        code: Test code to review
        
    Returns:
        Review with suggestions for improvement
    """
    suggestions = []
    
    if "page.waitForTimeout" in code:
        suggestions.append("❌ Avoid waitForTimeout() - use waitForSelector() or waitForLoadState() instead")
    
    if "sleep" in code.lower():
        suggestions.append("❌ Remove sleep/delay calls - use proper waits")
    
    if "expect" not in code:
        suggestions.append("⚠️ Add assertions to verify expected behavior")
    
    if "data-testid" not in code and "id=" in code:
        suggestions.append("💡 Consider using data-testid attributes for more stable selectors")
    
    if suggestions:
        return "Code Review Results:\n\n" + "\n".join(suggestions)
    else:
        return "✅ Code looks good! Follows best practices."


@tool
def explain_qa_concept(concept: str) -> str:
    """Explain QA automation concepts and best practices.
    
    Args:
        concept: The concept to explain
        
    Returns:
        Detailed explanation of the concept
    """
    concepts = {
        "page object model": """
Page Object Model (POM) is a design pattern that creates an abstraction layer between test scripts and web pages.

Key Benefits:
- Reduces code duplication
- Improves test maintenance
- Separates test logic from page structure
- Makes tests more readable

Example:
```typescript
class LoginPage {
  constructor(private page: Page) {}
  
  async login(username: string, password: string) {
    await this.page.fill('[data-testid="username"]', username);
    await this.page.fill('[data-testid="password"]', password);
    await this.page.click('[data-testid="login-button"]');
  }
}
```
""",
        "test pyramid": """
The Test Pyramid is a testing strategy that emphasizes:

1. **Unit Tests (Base)** - 70%
   - Fast, isolated, test individual functions
   - Mock external dependencies

2. **Integration Tests (Middle)** - 20%
   - Test component interactions
   - API testing, database integration

3. **E2E Tests (Top)** - 10%
   - Full user workflows
   - Browser automation tests

This approach ensures fast feedback while maintaining confidence.
"""
    }
    
    concept_lower = concept.lower()
    if concept_lower in concepts:
        return concepts[concept_lower]
    else:
        return f"I'd be happy to explain '{concept}'. This is a concept in QA automation that involves..."


@tool
def generate_test_scenarios(requirements: str) -> str:
    """Generate test scenarios from requirements.
    
    Args:
        requirements: Feature requirements or user story
        
    Returns:
        List of test scenarios
    """
    return f"""
Test Scenarios for: {requirements}

**Positive Test Cases:**
1. Happy path - user completes the main flow successfully
2. Valid inputs - test with valid data variations
3. Boundary values - test min/max valid inputs

**Negative Test Cases:**
1. Invalid inputs - test with invalid data
2. Missing required fields - test form validation
3. Unauthorized access - test security restrictions

**Edge Cases:**
1. Empty states - test with no data
2. Network issues - test offline/slow connection
3. Concurrent users - test simultaneous actions

**Accessibility Tests:**
1. Keyboard navigation - test without mouse
2. Screen reader compatibility - test with assistive tech
3. Color contrast - verify accessibility standards

**Performance Tests:**
1. Load time - measure page load performance
2. Response time - test API response times
3. Memory usage - monitor resource consumption
"""


@tool
def debug_test_failure(error: str) -> str:
    """Help debug test failures and provide solutions.
    
    Args:
        error: Error message or description of test failure
        
    Returns:
        Debugging suggestions and solutions
    """
    debugging_guide = {
        "element not found": """
**Element Not Found Error**

Common causes and solutions:
1. **Timing issue** - Element loads after test runs
   - Solution: Use waitForSelector() or waitForLoadState()
   
2. **Incorrect selector** - Element selector has changed
   - Solution: Inspect element and update selector
   
3. **Dynamic content** - Element is conditionally rendered
   - Solution: Add conditional checks or multiple selectors

Example fix:
```typescript
// ❌ Bad - immediate click
await page.click('[data-testid="submit"]');

// ✅ Good - wait for element
await page.waitForSelector('[data-testid="submit"]');
await page.click('[data-testid="submit"]');
```
""",
        "timeout": """
**Timeout Error**

Common causes:
1. Slow loading pages or API calls
2. Network latency
3. JavaScript execution delays

Solutions:
1. Increase timeout for specific actions
2. Use proper wait strategies
3. Optimize application performance

Example:
```typescript
// Increase timeout for slow operations
await page.click('[data-testid="submit"]', { timeout: 10000 });
await page.waitForLoadState('networkidle');
```
""",
        "flaky": """
**Flaky Test Issues**

Common causes:
1. Race conditions
2. Asynchronous operations
3. External dependencies
4. Test data interference

Solutions:
1. Use proper waits instead of fixed delays
2. Isolate test data
3. Mock external services
4. Make tests idempotent

Best practices:
- Use data-testid attributes
- Wait for specific conditions
- Clean up test data
- Run tests in parallel safely
"""
    }
    
    error_lower = error.lower()
    for key, solution in debugging_guide.items():
        if key in error_lower:
            return solution
    
    return f"""
**Debugging Test Failure**

Error: {error}

General debugging steps:
1. Check element selectors
2. Add explicit waits
3. Verify test data setup
4. Check for timing issues
5. Review error logs and screenshots
6. Run test in headed mode for debugging
"""


@tool
def get_qa_best_practices(category: str) -> str:
    """Get QA automation best practices for specific categories.
    
    Args:
        category: Category of best practices (selectors, structure, etc.)
        
    Returns:
        Best practices for the specified category
    """
    practices = {
        "selectors": """
**Selector Best Practices**

1. **Priority Order:**
   - data-testid (most stable)
   - id attributes
   - class names (if stable)
   - text content (last resort)

2. **Examples:**
   ```typescript
   // ✅ Good - stable test ID
   await page.click('[data-testid="submit-button"]');
   
   // ⚠️ OK - if stable
   await page.click('#submit-btn');
   
   // ❌ Avoid - fragile
   await page.click('.btn.btn-primary.submit');
   ```

3. **Tips:**
   - Use semantic, descriptive test IDs
   - Avoid CSS selectors tied to styling
   - Create reusable selector constants
""",
        "structure": """
**Test Structure Best Practices**

1. **AAA Pattern:**
   - **Arrange** - Set up test data and conditions
   - **Act** - Perform the action being tested
   - **Assert** - Verify the expected outcome

2. **Test Organization:**
   ```typescript
   test.describe('User Login', () => {
     test.beforeEach(async ({ page }) => {
       await page.goto('/login');
     });
     
     test('successful login with valid credentials', async ({ page }) => {
       // Arrange
       const username = 'testuser';
       const password = 'password123';
       
       // Act
       await loginPage.login(username, password);
       
       // Assert
       await expect(page).toHaveURL('/dashboard');
     });
   });
   ```

3. **Guidelines:**
   - One assertion per test when possible
   - Clear, descriptive test names
   - Independent tests that can run in any order
"""
    }
    
    category_lower = category.lower()
    if category_lower in practices:
        return practices[category_lower]
    else:
        return f"Best practices for {category}: Focus on maintainability, reliability, and clear communication through code."


@tool
def create_page_object(page_name: str, elements: str) -> str:
    """Create a Page Object class for the specified page.
    
    Args:
        page_name: Name of the page (e.g., "Login", "Dashboard")
        elements: Description of page elements and actions
        
    Returns:
        Generated Page Object class code
    """
    
    template = f"""
export class {page_name}Page {{
  constructor(private page: Page) {{}}

  // Selectors
  private selectors = {{
    // Add your selectors here based on: {elements}
    submitButton: '[data-testid="submit"]',
    errorMessage: '[data-testid="error"]'
  }};

  // Page actions
  async navigate() {{
    await this.page.goto('/{page_name.lower()}');
    await this.page.waitForLoadState('networkidle');
  }}

  async waitForPageLoad() {{
    await this.page.waitForSelector(this.selectors.submitButton);
  }}

  // Add specific methods based on page functionality
  async performAction() {{
    await this.page.click(this.selectors.submitButton);
  }}

  // Verification methods
  async isErrorDisplayed(): Promise<boolean> {{
    return this.page.isVisible(this.selectors.errorMessage);
  }}

  async getErrorText(): Promise<string> {{
    return this.page.textContent(this.selectors.errorMessage) ?? '';
  }}
}}
"""
    
    return template.strip()
