import json
import time
from pathlib import Path

import pytest

from app.services import framework_run_service as fr
from app.services import scaffold_service


def _starter(tmp_path: Path, framework: str, language: str) -> Path:
    target = tmp_path / f"{framework}-{language}"
    return scaffold_service.create_project(target, framework, language, "Demo", "a", "a@b.c")


def _targets(framework):
    return {t.label: t for t in framework.targets}


def test_detects_every_starter_template(tmp_path):
    expected = {
        ("playwright", "javascript"): "Playwright", ("playwright", "python"): "pytest · Playwright",
        ("playwright", "java"): "Maven · Playwright + JUnit 5", ("selenium", "java"): "Maven · Selenium + JUnit 5",
        ("selenium", "python"): "pytest · Selenium", ("selenium", "javascript"): "Selenium WebDriver",
        ("cypress", "javascript"): "Cypress", ("webdriverio", "javascript"): "WebdriverIO",
        ("appium", "java"): "Maven · Appium + TestNG", ("appium", "python"): "pytest · Appium",
        ("appium", "javascript"): "Appium", ("postman", "javascript"): "Postman (Newman)",
        ("restassured", "java"): "Maven · RestAssured + JUnit 5", ("karate", "java"): "Maven · Karate",
        ("junit5", "java"): "Maven · JUnit 5", ("robotframework", "python"): "Robot Framework",
        ("k6", "javascript"): "k6", ("bruno", "javascript"): "npm scripts",
    }
    assert set(expected) == set(scaffold_service.TEMPLATES)
    for (framework, language), name in expected.items():
        found = fr.detect(_starter(tmp_path, framework, language))
        assert name in [f.name for f in found], (framework, language, [f.name for f in found])


def test_maven_targets_include_classes_and_setup(tmp_path):
    repo = _starter(tmp_path, "junit5", "java")
    maven = next(f for f in fr.detect(repo) if f.id.startswith("maven"))
    targets = _targets(maven)
    assert {"All tests (mvn test)", "PriceCalculatorTest",
            "Download dependencies & compile (mvn test-compile)"} <= set(targets)
    plan = fr.build_plan(repo, targets["PriceCalculatorTest"].id, tmp_path / "artifacts", "-DbaseUrl=http://x")
    assert plan.argv[1:] == ["-B", "-ntp", "-Dstyle.color=never", "test", "-Dtest=PriceCalculatorTest",
                             "-Dsurefire.failIfNoSpecifiedTests=false", "-DbaseUrl=http://x"]
    assert plan.seed["junit"][0]["dir"].endswith("target/surefire-reports")
    assert plan.label == "Maven · JUnit 5: PriceCalculatorTest"


def test_playwright_plan_writes_junit_and_html_into_artifacts(tmp_path, monkeypatch):
    monkeypatch.setattr(fr.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(scaffold_service, "tool_path", lambda name: f"/usr/bin/{name}")
    repo = _starter(tmp_path, "playwright", "javascript")
    playwright = next(f for f in fr.detect(repo) if f.name == "Playwright")
    spec = _targets(playwright)["tests/web-form.spec.js"]
    artifacts = tmp_path / "run"
    plan = fr.build_plan(repo, spec.id, artifacts, '--grep "submits the form"')
    assert plan.argv == ["/usr/bin/npx", "--no-install", "playwright", "test", "tests/web-form.spec.js",
                         "--reporter=list,junit,html", "--grep", "submits the form"]
    assert plan.env["PLAYWRIGHT_JUNIT_OUTPUT_NAME"] == str(artifacts / "junit" / "playwright.xml")
    assert "Dependencies are not installed" in " ".join(plan.warnings)


def test_pytest_and_robot_plans(tmp_path, monkeypatch):
    monkeypatch.setattr(scaffold_service, "tool_path", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(fr, "_python_has", lambda python, module: True)
    py = _starter(tmp_path, "selenium", "python")
    pytest_fw = next(f for f in fr.detect(py) if f.name.startswith("pytest"))
    plan = fr.build_plan(py, _targets(pytest_fw)["All tests"].id, tmp_path / "a1")
    assert plan.argv[:3] == ["/usr/bin/python", "-m", "pytest"]
    assert f"--junitxml={tmp_path / 'a1' / 'junit' / 'pytest.xml'}" in plan.argv
    assert "Create virtual environment (.venv)" in _targets(pytest_fw)

    robot_repo = _starter(tmp_path, "robotframework", "python")
    robot = next(f for f in fr.detect(robot_repo) if f.name == "Robot Framework")
    plan = fr.build_plan(robot_repo, _targets(robot)["All suites (tests)"].id, tmp_path / "a2")
    assert plan.argv[-1] == "tests" and "--xunit" in plan.argv
    assert plan.seed["reports"][0].endswith("robot/report.html")


def test_npm_script_extra_args_go_after_double_dash(tmp_path, monkeypatch):
    monkeypatch.setattr(scaffold_service, "tool_path", lambda name: f"/usr/bin/{name}")
    repo = _starter(tmp_path, "k6", "javascript")
    npm = next(f for f in fr.detect(repo) if f.name == "npm scripts")
    plan = fr.build_plan(repo, _targets(npm)["npm run load"].id, tmp_path / "a", "--vus 2")
    assert plan.argv == ["/usr/bin/npm", "run", "load", "--", "--vus", "2"]


def test_unknown_or_tampered_target_is_rejected(tmp_path):
    repo = _starter(tmp_path, "junit5", "java")
    with pytest.raises(ValueError, match="no longer present"):
        fr.build_plan(repo, "maven@.|class|Evil; rm -rf /", tmp_path / "a")
    maven = next(f for f in fr.detect(repo) if f.id.startswith("maven"))
    with pytest.raises(ValueError, match="too long"):
        fr.build_plan(repo, maven.targets[0].id, tmp_path / "a", "x" * 600)


def test_parse_junit_handles_nested_suites_and_failures(tmp_path):
    xml = tmp_path / "r.xml"
    xml.write_text("""<testsuite name="root"><testsuite name="child">
      <testcase classname="Login" name="ok" time="0.5"/>
      <testcase classname="Login" name="bad" time="1"><failure message="expected 1">trace</failure></testcase>
      <testcase classname="Login" name="skip"><skipped/></testcase>
    </testsuite></testsuite>""")
    results = fr.parse_junit([xml])
    statuses = [(r["test_name"], r["status"]) for r in results]
    assert statuses == [("ok", "passed"), ("bad", "failed"), ("skip", "skipped")]
    assert results[0]["duration_ms"] == 500 and results[1]["error_message"] == "expected 1"


@pytest.mark.parametrize("parser,log,expected", [
    ("mocha", "  3 passing (2s)\n  1 failing\n  2 pending", (3, 1, 2)),
    ("playwright", "  5 passed (3.1s)\n  2 failed", (5, 2, 0)),
    ("jest", "Tests:       1 failed, 4 passed, 5 total", (4, 1, 0)),
    ("wdio", "Spec Files:\t 2 passed, 1 failed, 3 total (100% completed)", (2, 1, 0)),
    ("auto", "  7 passing (1s)", (7, 0, 0)),
    ("wdio", "[chrome] 2 passing (4s)\n[firefox] 1 passing (3s)\n[firefox] 1 failing\nSpec Files: 1 passed", (3, 1, 0)),
    ("auto", "│ Status        │    ✓ PASS    │\n│ Tests         │     4/5      │", (4, 1, 0)),
])
def test_console_summary_parsers(parser, log, expected):
    summary = fr.parse_console_summary(parser, log)
    assert (summary["passed"], summary["failed"], summary["skipped"]) == expected


def test_k6_summary_checks_and_thresholds(tmp_path):
    summary = tmp_path / "k6.json"
    summary.write_text(json.dumps({
        "root_group": {"checks": {"status is 200": {"passes": 3, "fails": 0}, "fast": {"passes": 1, "fails": 2}},
                       "groups": {}},
        "metrics": {"http_req_duration": {"thresholds": {"p(95)<2000": {"ok": True}}},
                    "checks": {"thresholds": {"rate==1.0": {"ok": False}}}},
    }))
    results = {r["test_name"]: r["status"] for r in fr.parse_k6_summary(summary)}
    assert results == {"check: status is 200": "passed", "check: fast": "failed",
                       "threshold: http_req_duration p(95)<2000": "passed", "threshold: checks rate==1.0": "failed"}


def test_collect_results_prefers_junit_then_console_then_exit_code(tmp_path):
    started = time.time()
    artifacts = tmp_path / "run"
    (artifacts / "junit").mkdir(parents=True)
    seed = {"framework": "Demo", "target_label": "All", "junit": [{"dir": str(artifacts / "junit"),
            "pattern": "*.xml", "since": False}], "parser": "mocha", "reports": [], "command": ["x"]}
    (artifacts / "process.log").write_text("  2 passing\n")
    parsed, details = fr.collect_results(seed, artifacts, started, 0)
    assert parsed["source"] == "console output" and parsed["passed_tests"] == 2
    assert details["type"] == "framework" and details["exit_code"] == 0

    (artifacts / "junit" / "a.xml").write_text('<testsuite><testcase name="t" classname="c"/></testsuite>')
    parsed, _ = fr.collect_results(seed, artifacts, started, 0)
    assert parsed["source"] == "JUnit XML" and parsed["total_tests"] == 1

    parsed, _ = fr.collect_results({**seed, "junit": [], "parser": None}, artifacts, started, 3)
    assert parsed["source"] == "exit code" and parsed["failed_tests"] == 1


def test_bruno_collections_are_left_to_the_bruno_runner(tmp_path):
    collection = tmp_path / "api" / "orders"
    collection.mkdir(parents=True)
    (collection / "bruno.json").write_text("{}")
    (collection / "package.json").write_text(json.dumps({"scripts": {"test": "bru run"}}))
    assert fr.detect(tmp_path) == []
