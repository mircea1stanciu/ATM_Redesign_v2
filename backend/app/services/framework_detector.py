import re
from enum import Enum
from typing import Optional


class TestFramework(str, Enum):
    PYTEST = "pytest"
    PLAYWRIGHT = "playwright"
    APPIUM = "appium"
    CYPRESS = "cypress"
    ROBOT = "robot"
    BRUNO = "bruno"
    JUNIT = "junit"
    UNKNOWN = "unknown"


class FrameworkDetector:
    """Detect test framework from repository content."""
    
    # Framework markers - files/patterns that indicate framework usage
    FRAMEWORK_MARKERS = {
        TestFramework.PYTEST: [
            "pytest.ini",
            "setup.cfg",  # with pytest config
            "pyproject.toml",  # with pytest config
            "conftest.py",
            "test_*.py",
            "*_test.py",
        ],
        TestFramework.PLAYWRIGHT: [
            "playwright.config.ts",
            "playwright.config.js",
            "@playwright/test",
        ],
        TestFramework.APPIUM: [
            "appium.config.js",
            "appium.config.ts",
            "appium.yml",
            "@appium",
            "webdriverio",
        ],
        TestFramework.CYPRESS: [
            "cypress.config.js",
            "cypress.config.ts",
            "cypress/e2e",
            "cypress/integration",
        ],
        TestFramework.ROBOT: [
            "robot.yaml",
            "robot.config",
            ".robot",  # Changed from "*.robot" for better matching
        ],
        TestFramework.BRUNO: [
            "bruno.json",
            ".bru",
            "/bruno/",
        ],
        TestFramework.JUNIT: [
            "pom.xml",
            "build.gradle",
            "*.jar",
        ],
    }
    
    @staticmethod
    def detect_from_files(file_paths: list[str]) -> TestFramework:
        """
        Detect test framework from list of file paths.
        
        Args:
            file_paths: List of file paths from repository
            
        Returns:
            Detected TestFramework or UNKNOWN
        """
        file_paths_lower = [p.lower() for p in file_paths]
        
        # Check each framework in order of specificity (most specific first)
        # Robot framework should be checked early to avoid confusing with Python
        for framework in [
            TestFramework.ROBOT,
            TestFramework.BRUNO,
            TestFramework.PLAYWRIGHT,
            TestFramework.APPIUM,
            TestFramework.CYPRESS,
            TestFramework.JUNIT,
            TestFramework.PYTEST,
        ]:
            markers = FrameworkDetector.FRAMEWORK_MARKERS.get(framework, [])
            for marker in markers:
                if any(marker.lower() in path for path in file_paths_lower):
                    return framework
        
        return TestFramework.UNKNOWN

    @staticmethod
    def detect_frameworks(file_paths: list[str]) -> list[str]:
        """Return detected frameworks as list of framework names for API compatibility."""
        framework = FrameworkDetector.detect_from_files(file_paths)
        if framework == TestFramework.UNKNOWN:
            return []
        return [framework.value]

    @staticmethod
    def detect_suites(file_paths: list[str]) -> list[str]:
        """Extract collection/suite directories from repository files."""
        return [p["path"] for p in FrameworkDetector.detect_projects(file_paths)]

    @staticmethod
    def detect_projects(file_paths: list[str]) -> list[dict]:
        """Extract collection directories with their available environments."""
        framework = FrameworkDetector.detect_from_files(file_paths)

        if framework == TestFramework.BRUNO:
            # Map: collection_path -> set of environment names (.bru filenames without extension)
            collection_envs: dict = {}

            for path in file_paths:
                p = path.strip("/")
                parts = p.split("/")
                for i, part in enumerate(parts):
                    if part.lower() in ("environment", "environments") and i > 0:
                        collection_path = "/".join(parts[:i])
                        last_segment = parts[i - 1].lower()
                        if last_segment in ("environment", "environments") or not collection_path:
                            continue
                        if collection_path not in collection_envs:
                            collection_envs[collection_path] = set()
                        # Add only direct .bru files inside environment/environments/.
                        # Ignore nested folders and any non-.bru entries.
                        if i + 1 < len(parts) and len(parts) == i + 2:
                            env_file = parts[i + 1]
                            if env_file.lower().endswith(".bru"):
                                env_name = env_file.rsplit(".", 1)[0]
                                if env_name:
                                    collection_envs[collection_path].add(env_name)

            return [
                {"path": col, "environments": sorted(envs)}
                for col, envs in sorted(collection_envs.items())
            ]

        # For other frameworks: return plain paths with empty environments
        collections: set = set()
        for path in file_paths:
            p = path.strip("/")
            lower = p.lower()
            if lower.endswith(".robot"):
                parts = p.split("/")
                if len(parts) > 1:
                    collections.add(parts[0])
            elif lower.endswith((".cy.js", ".cy.ts", ".spec.ts", ".spec.js", ".test.ts", ".test.js")):
                parts = p.split("/")
                if len(parts) > 1:
                    collections.add(parts[0])
            elif lower.endswith(".py") and (
                "/tests/" in f"/{lower}" or "/test_" in f"/{lower}" or lower.endswith("_test.py")
            ):
                parts = p.split("/")
                if len(parts) > 1:
                    collections.add(parts[0])
        return [{"path": c, "environments": []} for c in sorted(collections)]

    @staticmethod
    def detect_from_content(content_dict: dict[str, str]) -> TestFramework:
        """
        Detect framework by analyzing file contents.
        
        Args:
            content_dict: Dict of {filename: content}
            
        Returns:
            Detected TestFramework or UNKNOWN
        """
        for filename, content in content_dict.items():
            # Playwright detection
            if "playwright" in content.lower() and (
                "@playwright/test" in content or "import.*playwright" in content.lower()
            ):
                return TestFramework.PLAYWRIGHT
            
            # Cypress detection
            if "cypress" in content.lower() and ("describe" in content or "it(" in content):
                if "cy." in content:
                    return TestFramework.CYPRESS

            # Appium detection
            if "appium" in content.lower() and (
                "@appium" in content.lower()
                or "webdriverio" in content.lower()
                or "desiredcapabilities" in content.lower()
                or "mobile:" in content.lower()
            ):
                return TestFramework.APPIUM
            
            # Pytest detection
            if filename.endswith((".py",)):
                if re.search(r"^import pytest", content, re.MULTILINE) or re.search(
                    r"^from pytest", content, re.MULTILINE
                ):
                    return TestFramework.PYTEST
                if re.search(r"def test_.*\(", content):
                    return TestFramework.PYTEST
            
            # Robot detection
            if filename.endswith(".robot"):
                return TestFramework.ROBOT

            # Bruno detection
            if filename.endswith(".bru") or filename.lower().endswith("bruno.json"):
                return TestFramework.BRUNO
            if "bruno" in content.lower() and "request" in content.lower() and "meta" in content.lower():
                return TestFramework.BRUNO
            
            # Java/JUnit detection
            if filename.endswith((".java", ".xml")):
                if "junit" in content.lower() or "testcase" in content.lower():
                    return TestFramework.JUNIT
        
        return TestFramework.UNKNOWN
    
    @staticmethod
    def get_run_command(framework: TestFramework, test_path: str = ".") -> str:
        """
        Get the command to run tests for a given framework.
        
        Args:
            framework: The test framework
            test_path: Path to tests directory
            
        Returns:
            Command to run tests
        """
        commands = {
            TestFramework.PYTEST: f"pytest {test_path} --junit-xml=results.xml -v",
            TestFramework.PLAYWRIGHT: f"npx playwright test {test_path}",
            TestFramework.APPIUM: "npm test",
            TestFramework.CYPRESS: f"npx cypress run --spec '{test_path}/**/*.cy.js'",
            TestFramework.ROBOT: f"robot {test_path}",
            TestFramework.BRUNO: f"bru run {test_path}",
            TestFramework.JUNIT: "mvn test",
        }
        return commands.get(framework, f"echo 'Unknown framework: {framework}'")
    
    @staticmethod
    def get_install_command(framework: TestFramework) -> Optional[str]:
        """
        Get the command to install test framework dependencies.
        
        Args:
            framework: The test framework
            
        Returns:
            Install command or None
        """
        commands = {
            TestFramework.PYTEST: "pip install pytest pytest-cov pytest-xdist",
            TestFramework.PLAYWRIGHT: "npm install && npx playwright install",
            TestFramework.APPIUM: "npm install",
            TestFramework.CYPRESS: "npm install",
            TestFramework.ROBOT: "pip install robotframework",
            TestFramework.BRUNO: "npm install -g @usebruno/cli",
        }
        return commands.get(framework)
