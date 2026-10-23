import xml.etree.ElementTree as ET
from typing import Any

from app.models.models import TestStatus


class JunitParser:
    """Parse JUnit XML test results."""
    
    @staticmethod
    def parse_file(file_path: str) -> dict[str, Any]:
        """
        Parse JUnit XML file and return test results.
        
        Args:
            file_path: Path to JUnit XML file
            
        Returns:
            Dictionary with parsed test data
        """
        try:
            tree = ET.parse(file_path)
            root = tree.getroot()
            return JunitParser.parse_root(root)
        except Exception as e:
            raise ValueError(f"Failed to parse JUnit XML: {str(e)}")
    
    @staticmethod
    def parse_string(xml_content: str) -> dict[str, Any]:
        """
        Parse JUnit XML string and return test results.
        
        Args:
            xml_content: JUnit XML as string
            
        Returns:
            Dictionary with parsed test data
        """
        try:
            root = ET.fromstring(xml_content)
            # Validate it's a test-related XML
            if root.tag not in ("testsuite", "testsuites"):
                raise ValueError(
                    f"Invalid JUnit XML: root element is '{root.tag}', "
                    "expected 'testsuite' or 'testsuites'"
                )
            return JunitParser.parse_root(root)
        except ET.ParseError as e:
            raise ValueError(f"Failed to parse JUnit XML: {str(e)}")
        except Exception as e:
            raise ValueError(f"Failed to parse JUnit XML: {str(e)}")
    
    @staticmethod
    def parse_root(root: ET.Element) -> dict[str, Any]:
        """Parse JUnit XML root element."""
        # Handle both <testsuites> and <testsuite> as root
        if root.tag == "testsuites":
            # Multiple test suites
            test_suites = root.findall("testsuite")
            results = []
            totals = {"tests": 0, "passed": 0, "failed": 0, "skipped": 0, "errors": 0}
            
            for suite in test_suites:
                suite_results = JunitParser._parse_suite(suite)
                results.extend(suite_results)
                totals["tests"] += int(suite.get("tests", 0))
                totals["passed"] += (
                    int(suite.get("tests", 0))
                    - int(suite.get("failures", 0))
                    - int(suite.get("errors", 0))
                    - int(suite.get("skipped", 0))
                )
                totals["failed"] += int(suite.get("failures", 0))
                totals["errors"] += int(suite.get("errors", 0))
                totals["skipped"] += int(suite.get("skipped", 0))
        else:
            # Single test suite
            results = JunitParser._parse_suite(root)
            # Count results by status
            passed = sum(1 for r in results if r["status"] == "passed")
            failed = sum(1 for r in results if r["status"] == "failed")
            errors = sum(1 for r in results if r["status"] == "error")
            skipped = sum(1 for r in results if r["status"] == "skipped")
            
            totals = {
                "tests": len(results),
                "passed": passed,
                "failed": failed,
                "errors": errors,
                "skipped": skipped,
            }
        
        return {
            "results": results,
            "totals": totals,
            "duration_seconds": float(root.get("time", 0)),
        }
    
    @staticmethod
    def _parse_suite(suite: ET.Element) -> list[dict[str, Any]]:
        """Parse a single test suite element."""
        results = []
        test_cases = suite.findall("testcase")
        
        for test_case in test_cases:
            result = JunitParser._parse_test_case(test_case)
            results.append(result)
        
        return results
    
    @staticmethod
    def _parse_test_case(test_case: ET.Element) -> dict[str, Any]:
        """Parse a single test case element."""
        name = test_case.get("name", "unknown")
        class_name = test_case.get("classname", "")
        duration_ms = float(test_case.get("time", 0)) * 1000  # Convert to milliseconds
        
        # Determine test status
        status = TestStatus.passed.value
        error_message = None
        stack_trace = None
        
        # Check for failure
        failure_elem = test_case.find("failure")
        if failure_elem is not None:
            status = TestStatus.failed.value
            error_message = failure_elem.get("message", "")
            stack_trace = failure_elem.text or ""
        
        # Check for error
        error_elem = test_case.find("error")
        if error_elem is not None:
            status = TestStatus.error.value
            error_message = error_elem.get("message", "")
            stack_trace = error_elem.text or ""
        
        # Check for skip
        skip_elem = test_case.find("skipped")
        if skip_elem is not None:
            status = TestStatus.skipped.value
            error_message = skip_elem.get("message", "")
        
        return {
            "test_name": name,
            "class_name": class_name,
            "status": status,
            "duration_ms": duration_ms,
            "error_message": error_message,
            "stack_trace": stack_trace,
        }


class TestResultBuilder:
    """Build test results from various sources."""
    
    @staticmethod
    def from_junit_output(
        junit_xml: str,
        stdout: str = "",
        stderr: str = "",
    ) -> dict[str, Any]:
        """
        Build complete test results from JUnit XML output.
        
        Args:
            junit_xml: JUnit XML content
            stdout: Standard output from test run
            stderr: Standard error from test run
            
        Returns:
            Dictionary with complete test results
        """
        # Parse JUnit XML
        parsed = JunitParser.parse_string(junit_xml)
        
        return {
            "test_results": parsed["results"],
            "total_tests": parsed["totals"]["tests"],
            "passed_tests": parsed["totals"]["passed"],
            "failed_tests": parsed["totals"]["failed"],
            "skipped_tests": parsed["totals"]["skipped"],
            "duration_seconds": parsed["duration_seconds"],
            "stdout": stdout,
            "stderr": stderr,
        }
    
    @staticmethod
    def from_raw_output(stdout: str, stderr: str, framework: str) -> dict[str, Any]:
        """
        Build test results from raw command output.
        
        Args:
            stdout: Standard output from test run
            stderr: Standard error from test run
            framework: Test framework name
            
        Returns:
            Dictionary with extracted test results
        """
        # Try to extract basic metrics from output
        results = []
        
        # Very basic parsing - framework-specific parsing should be implemented
        lines = (stdout + stderr).split("\n")
        
        for line in lines:
            if "passed" in line.lower() or "failed" in line.lower():
                # Try to extract counts
                import re
                passed = re.search(r"(\d+)\s+passed", line, re.IGNORECASE)
                failed = re.search(r"(\d+)\s+failed", line, re.IGNORECASE)
                skipped = re.search(r"(\d+)\s+skipped", line, re.IGNORECASE)
                
                if passed or failed:
                    total_passed = int(passed.group(1)) if passed else 0
                    total_failed = int(failed.group(1)) if failed else 0
                    total_skipped = int(skipped.group(1)) if skipped else 0
                    return {
                        "test_results": results,
                        "total_tests": total_passed + total_failed,
                        "passed_tests": total_passed,
                        "failed_tests": total_failed,
                        "skipped_tests": total_skipped,
                        "stdout": stdout,
                        "stderr": stderr,
                    }
        
        # Fallback: treat exit code success as passed
        return {
            "test_results": results,
            "total_tests": 0,
            "passed_tests": 0,
            "failed_tests": 0,
            "skipped_tests": 0,
            "stdout": stdout,
            "stderr": stderr,
        }
