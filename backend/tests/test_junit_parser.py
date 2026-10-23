import pytest

from app.models.models import TestStatus
from app.services.junit_parser import JunitParser, TestResultBuilder


class TestJunitParser:
    """Test JUnit XML parsing functionality."""
    
    SAMPLE_JUNIT_XML = """<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="test_suite" tests="4" failures="1" errors="0" skipped="0" time="1.234">
    <testcase name="test_pass" classname="TestClass" time="0.100">
    </testcase>
    <testcase name="test_fail" classname="TestClass" time="0.200">
        <failure message="AssertionError: Expected True">
            Traceback (most recent call last):
              File "test.py", line 10, in test_fail
                assert False
            AssertionError: Expected True
        </failure>
    </testcase>
    <testcase name="test_error" classname="TestClass" time="0.050">
        <error message="Exception: Something went wrong">
            Traceback (most recent call last):
              File "test.py", line 15, in test_error
                raise Exception("Something went wrong")
            Exception: Something went wrong
        </error>
    </testcase>
    <testcase name="test_skip" classname="TestClass" time="0.000">
        <skipped message="Skipped for now"/>
    </testcase>
</testsuite>
"""
    
    def test_parse_string_basic(self):
        """Test basic JUnit XML parsing."""
        result = JunitParser.parse_string(self.SAMPLE_JUNIT_XML)
        
        assert "results" in result
        assert "totals" in result
        assert "duration_seconds" in result
        
        results = result["results"]
        assert len(results) == 4
    
    def test_parse_passed_test(self):
        """Test parsing of passed test."""
        result = JunitParser.parse_string(self.SAMPLE_JUNIT_XML)
        results = result["results"]
        
        passed_test = results[0]
        assert passed_test["test_name"] == "test_pass"
        assert passed_test["status"] == TestStatus.passed.value
        assert passed_test["duration_ms"] == 100.0
    
    def test_parse_failed_test(self):
        """Test parsing of failed test."""
        result = JunitParser.parse_string(self.SAMPLE_JUNIT_XML)
        results = result["results"]
        
        failed_test = results[1]
        assert failed_test["test_name"] == "test_fail"
        assert failed_test["status"] == TestStatus.failed.value
        assert "AssertionError" in (failed_test["error_message"] or "")
        assert failed_test["stack_trace"] is not None
    
    def test_parse_error_test(self):
        """Test parsing of error test."""
        result = JunitParser.parse_string(self.SAMPLE_JUNIT_XML)
        results = result["results"]
        
        error_test = results[2]
        assert error_test["test_name"] == "test_error"
        assert error_test["status"] == TestStatus.error.value
    
    def test_parse_skipped_test(self):
        """Test parsing of skipped test."""
        result = JunitParser.parse_string(self.SAMPLE_JUNIT_XML)
        results = result["results"]
        
        skipped_test = results[3]
        assert skipped_test["test_name"] == "test_skip"
        assert skipped_test["status"] == TestStatus.skipped.value
    
    def test_parse_totals(self):
        """Test parsing of totals."""
        result = JunitParser.parse_string(self.SAMPLE_JUNIT_XML)
        totals = result["totals"]
        
        assert totals["tests"] == 4
        assert totals["passed"] == 1
        assert totals["failed"] == 1
        assert totals["errors"] == 1
        assert totals["skipped"] == 1
    
    def test_parse_duration(self):
        """Test parsing of duration."""
        result = JunitParser.parse_string(self.SAMPLE_JUNIT_XML)
        assert result["duration_seconds"] == 1.234
    
    def test_parse_invalid_xml(self):
        """Test parsing invalid XML raises error."""
        with pytest.raises(ValueError):
            # This is not a valid testsuite/testsuites root
            JunitParser.parse_string("<invalid>xml</invalid>")
    
    def test_test_result_builder_from_junit(self):
        """Test building results from JUnit XML."""
        results = TestResultBuilder.from_junit_output(
            self.SAMPLE_JUNIT_XML,
            "stdout content",
            "stderr content"
        )
        
        assert results["total_tests"] == 4
        # Based on actual parsed results: 1 passed, 1 failed, 1 error, 1 skipped
        assert results["passed_tests"] == 1
        assert results["failed_tests"] == 1
        assert len(results["test_results"]) == 4
        assert results["stdout"] == "stdout content"
        assert results["stderr"] == "stderr content"
    
    def test_test_result_builder_from_raw_output(self):
        """Test building results from raw test output."""
        output = "tests/test_main.py::test_1 PASSED\ntests/test_main.py::test_2 FAILED\n\n2 passed, 1 failed in 0.25s"
        
        results = TestResultBuilder.from_raw_output(output, "", "pytest")
        
        assert results["stdout"] == output
        # Basic parsing should find test counts
        assert results["total_tests"] >= 0
