from app.services.framework_detector import FrameworkDetector, TestFramework


class TestFrameworkDetector:
    """Test framework detection functionality."""
    
    def test_detect_pytest_from_files(self):
        """Test pytest detection from file paths."""
        files = [
            "tests/test_main.py",
            "tests/conftest.py",
            "setup.py",
        ]
        framework = FrameworkDetector.detect_from_files(files)
        assert framework == TestFramework.PYTEST
    
    def test_detect_pytest_from_config(self):
        """Test pytest detection from pytest.ini."""
        files = ["pytest.ini", "src/main.py"]
        framework = FrameworkDetector.detect_from_files(files)
        assert framework == TestFramework.PYTEST
    
    def test_detect_playwright_from_files(self):
        """Test Playwright detection."""
        files = [
            "playwright.config.ts",
            "tests/e2e.spec.ts",
        ]
        framework = FrameworkDetector.detect_from_files(files)
        assert framework == TestFramework.PLAYWRIGHT
    
    def test_detect_cypress_from_files(self):
        """Test Cypress detection."""
        files = [
            "cypress.config.js",
            "cypress/e2e/main.cy.js",
        ]
        framework = FrameworkDetector.detect_from_files(files)
        assert framework == TestFramework.CYPRESS
    
    def test_detect_robot_from_files(self):
        """Test Robot Framework detection."""
        files = [
            "tests/main.robot",
            "src/main.py",
        ]
        framework = FrameworkDetector.detect_from_files(files)
        assert framework == TestFramework.ROBOT

    def test_detect_bruno_from_files(self):
        """Test Bruno detection from collection files."""
        files = [
            "bruno.json",
            "collections/health-check.bru",
        ]
        framework = FrameworkDetector.detect_from_files(files)
        assert framework == TestFramework.BRUNO

    def test_detect_frameworks_api_compat(self):
        """Test API compatibility method for framework list output."""
        files = [
            "bruno.json",
            "collections/health-check.bru",
        ]
        frameworks = FrameworkDetector.detect_frameworks(files)
        assert frameworks == ["bruno"]

    def test_detect_suites_api_compat(self):
        """Test API compatibility: Bruno detects collections from environments folders."""
        files = [
            "bruno.json",
            "collections/health-check/environments/dev.bru",
            "collections/api-tests/environments/prod.bru",
        ]
        suites = FrameworkDetector.detect_suites(files)
        assert "collections/health-check" in suites
        assert "collections/api-tests" in suites

    def test_detect_suites_mixed_python_frameworks(self):
        """Test suite detection with Python frameworks (non-Bruno)."""
        files = [
            "tests/api/test_users.py",
            "tests/e2e/login.spec.ts",
            "tests/unit/helpers.test.ts",
        ]
        suites = FrameworkDetector.detect_suites(files)
        # Should return the test directories since no Bruno framework
        assert "tests" in suites


    def test_detect_bruno_collections_from_environment(self):
        """Test Bruno collection detection: both 'environment' and 'environments' folder names."""
        files = [
            "bruno.json",
            "health-check/environments/dev.bru",
            "health-check/environments/prod.bru",
            "health-check/request.bru",
            "api-tests/environments/test.bru",
            "api-tests/request.bru",
        ]
        suites = FrameworkDetector.detect_suites(files)
        assert "health-check" in suites
        assert "api-tests" in suites

    def test_detect_bruno_deep_nested_collections(self):
        """Test Bruno collection detection goes deep into subfolders."""
        files = [
            "bruno.json",
            "athena/collection-a/environments/dev.bru",
            "athena/collection-b/environments/prod.bru",
            "digital-lending/loans/environments/test.bru",
            "digital-lending/cards/environments/dev.bru",
        ]
        suites = FrameworkDetector.detect_suites(files)
        assert "athena/collection-a" in suites
        assert "athena/collection-b" in suites
        assert "digital-lending/loans" in suites
        assert "digital-lending/cards" in suites
        assert "athena" not in suites
        assert "digital-lending" not in suites

    def test_detect_bruno_excludes_environment_dirs(self):
        """Test that environment/environments directories are not themselves returned as collections."""
        files = [
            "bruno.json",
            "athena/environments/dev.bru",
            "digital-lending/environments/prod.bru",
            "open-banking/environments/test.bru",
        ]
        suites = FrameworkDetector.detect_suites(files)
        assert "athena" in suites
        assert "digital-lending" in suites
        assert "open-banking" in suites
        assert "environment" not in suites
        assert "environments" not in suites

    def test_detect_bruno_ignores_nested_environment_folders(self):
        """Test Bruno environments include only direct .bru files, not nested folders/files."""
        files = [
            "bruno.json",
            "athena/collection-a/environments/dev.bru",
            "athena/collection-a/environments/prod.bru",
            "athena/collection-a/environments/team-a/qa.bru",
            "athena/collection-a/environments/README.md",
        ]
        projects = FrameworkDetector.detect_projects(files)
        collection = next((p for p in projects if p["path"] == "athena/collection-a"), None)

        assert collection is not None
        assert collection["environments"] == ["dev", "prod"]


    
    def test_detect_unknown_framework(self):
        """Test unknown framework returns UNKNOWN."""
        files = ["src/main.py", "README.md"]
        framework = FrameworkDetector.detect_from_files(files)
        assert framework == TestFramework.UNKNOWN
    
    def test_get_pytest_run_command(self):
        """Test pytest run command generation."""
        cmd = FrameworkDetector.get_run_command(TestFramework.PYTEST, "tests/")
        assert "pytest" in cmd
        assert "tests/" in cmd
        assert "--junit-xml" in cmd
    
    def test_get_playwright_run_command(self):
        """Test Playwright run command generation."""
        cmd = FrameworkDetector.get_run_command(TestFramework.PLAYWRIGHT, "tests/")
        assert "playwright" in cmd
    
    def test_get_cypress_run_command(self):
        """Test Cypress run command generation."""
        cmd = FrameworkDetector.get_run_command(TestFramework.CYPRESS, "e2e/")
        assert "cypress" in cmd

    def test_get_bruno_run_command(self):
        """Test Bruno run command generation."""
        cmd = FrameworkDetector.get_run_command(TestFramework.BRUNO, "collections/")
        assert "bru run" in cmd
        assert "collections/" in cmd
    
    def test_detect_from_content_pytest(self):
        """Test pytest detection from file content."""
        content = {
            "test_main.py": """
import pytest

def test_something():
    assert True
"""
        }
        framework = FrameworkDetector.detect_from_content(content)
        assert framework == TestFramework.PYTEST
    
    def test_detect_from_content_playwright(self):
        """Test Playwright detection from content."""
        content = {
            "test.ts": """
import { test, expect } from '@playwright/test';

test('example', async ({ page }) => {
  await page.goto('https://example.com');
});
"""
        }
        framework = FrameworkDetector.detect_from_content(content)
        assert framework == TestFramework.PLAYWRIGHT
    
    def test_get_pytest_install_command(self):
        """Test pytest install command."""
        cmd = FrameworkDetector.get_install_command(TestFramework.PYTEST)
        assert cmd is not None
        assert "pytest" in cmd
    
    def test_get_playwright_install_command(self):
        """Test Playwright install command."""
        cmd = FrameworkDetector.get_install_command(TestFramework.PLAYWRIGHT)
        assert cmd is not None
        assert "playwright" in cmd

    def test_get_bruno_install_command(self):
        """Test Bruno install command."""
        cmd = FrameworkDetector.get_install_command(TestFramework.BRUNO)
        assert cmd is not None
        assert "@usebruno/cli" in cmd
