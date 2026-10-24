"""Detect and run any test framework found in a linked local checkout.

Bruno collections and Appium (Cucumber/TestNG device) projects have their own, richer run
forms. Everything else is handled here: Playwright, Cypress, WebdriverIO, Mocha (Selenium /
Appium JS), Jest, Postman (Newman), k6, npm scripts, Maven and Gradle (Selenium, Playwright,
RestAssured, Karate, JUnit 5, TestNG, Cucumber, Appium), pytest (Playwright, Selenium, Appium)
and Robot Framework.

The browser only ever sends a *target id* returned by :func:`detect`; the command line is
rebuilt from a fresh detection, so arbitrary commands cannot be injected. Optional extra
arguments are split without a shell and appended.
"""
from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass, field
from pathlib import Path

from app.services import scaffold_service

FRAMEWORK_TARGET_PREFIX = "framework:"
MAX_FILE_TARGETS = 150
MAX_SCAN_FILES = 8000
MAX_EXTRA_ARGS_LENGTH = 500
_SKIP_DIRS = {
    ".git", "node_modules", "target", "build", "dist", "out", ".venv", "venv", "env", "__pycache__", ".idea",
    ".vscode", ".gradle", ".automationtestmanager", "coverage", "playwright-report", "test-results", "reports",
    ".pytest_cache", ".mypy_cache", ".tox", "allure-results", "allure-report", "site-packages",
}
_NPM_LIFECYCLE = re.compile(
    r"^(pre|post)?(install|uninstall|prepare|prepublish(only)?|publish|pack|version|shrinkwrap)$"
)
_JS_TEST_SUFFIX = re.compile(r"\.(spec|test)\.(c|m)?(j|t)sx?$")
_CY_SPEC = re.compile(r"\.cy\.(j|t)sx?$")
_WDIO_SPEC = re.compile(r"\.(e2e|spec|test)\.(j|t)s$")
_WDIO_CONF = re.compile(r"^wdio(\.[\w-]+)?\.conf\.(c|m)?(j|t)s$")
_JAVA_TEST_MARKERS = ("@Test", "@Karate.Test", "@CucumberOptions", "AbstractTestNGCucumberTests", "@ParameterizedTest")
_K6_IMPORT = re.compile(r"""from\s+['"]k6(/[\w-]+)?['"]|require\(\s*['"]k6(/[\w-]+)?['"]\s*\)""")

_HINTS = {
    "node": "Install Node.js LTS from https://nodejs.org",
    "npx": "npx ships with Node.js",
    "npm": "npm ships with Node.js",
    "mvn": "Install Apache Maven (https://maven.apache.org) or add the Maven wrapper (mvnw)",
    "gradle": "Install Gradle (https://gradle.org) or add the Gradle wrapper (gradlew)",
    "python": "Install Python 3.10+ from https://www.python.org",
    "k6": "Install k6 from https://grafana.com/docs/k6/latest/set-up/install-k6/",
    "newman": "Run 'npm install' (newman in devDependencies) or 'npm install -g newman'",
}


# ── Data model ───────────────────────────────────────────────────────────────

@dataclass
class Target:
    id: str
    label: str
    group: str  # "Run tests" | "Test files" | "Test classes" | "Suites" | "npm scripts" | "Setup"
    description: str = ""


@dataclass
class Framework:
    id: str
    name: str
    language: str
    root: str  # folder relative to the checkout ("." for the root)
    runner: str
    stacks: list[str] = field(default_factory=list)
    tools: list[str] = field(default_factory=list)
    missing_tools: list[dict] = field(default_factory=list)
    issues: list[str] = field(default_factory=list)
    targets: list[Target] = field(default_factory=list)
    # Internal: target id -> recipe used to build the command. Not sent to the browser.
    recipes: dict[str, dict] = field(default_factory=dict, repr=False)

    def public(self) -> dict:
        data = asdict(self)
        data.pop("recipes", None)
        return data

    def add(self, key: str, label: str, group: str, recipe: dict, description: str = "") -> None:
        target_id = f"{self.id}|{key}"
        self.targets.append(Target(target_id, label, group, description))
        self.recipes[target_id] = recipe


@dataclass
class RunPlan:
    argv: list[str]
    cwd: str
    env: dict[str, str]
    target: str
    label: str
    seed: dict  # everything needed to collect results, also after a backend restart
    warnings: list[str] = field(default_factory=list)


# ── File helpers ─────────────────────────────────────────────────────────────

def _read(path: Path, limit: int = 512 * 1024) -> str:
    try:
        with open(path, "rb") as handle:
            return handle.read(limit).decode("utf-8", errors="replace")
    except OSError:
        return ""


def _walk(root: Path, max_depth: int = 8):
    """Yield files under ``root`` (skipping build/dependency folders), bounded for big repos."""
    seen = 0
    stack = [(root, 0)]
    while stack:
        directory, depth = stack.pop()
        try:
            entries = sorted(directory.iterdir(), key=lambda p: p.name.lower(), reverse=True)
        except OSError:
            continue
        for entry in entries:
            if entry.is_symlink():
                continue
            if entry.is_dir():
                if entry.name not in _SKIP_DIRS and not entry.name.startswith(".") and depth < max_depth:
                    stack.append((entry, depth + 1))
            elif entry.is_file():
                seen += 1
                if seen > MAX_SCAN_FILES:
                    return
                yield entry


def _rel(path: Path, base: Path) -> str:
    return path.relative_to(base).as_posix()


def _venv_python(root: Path) -> Path | None:
    for candidate in (root / ".venv", root / "venv"):
        python = candidate / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        if python.is_file():
            return python
    return None


def _python_has(python: str, module: str) -> bool:
    try:
        result = subprocess.run([python, "-c", f"import {module}"], capture_output=True, timeout=20, check=False)
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0


def _wrapper(root: Path, repo: Path, names: tuple[str, ...]) -> Path | None:
    """Find a Maven/Gradle wrapper in ``root`` or a parent folder up to the checkout root."""
    folder = root
    while True:
        for name in names:
            candidate = folder / name
            if candidate.is_file():
                return candidate
        if folder == repo or repo not in folder.parents:
            return None
        folder = folder.parent


def _missing(framework: Framework, tool: str, available: bool) -> None:
    framework.tools.append(tool)
    if not available:
        framework.missing_tools.append({"tool": tool, "hint": _HINTS.get(tool, "")})


# ── Detection ────────────────────────────────────────────────────────────────

def _project_roots(repo: Path) -> list[Path]:
    """The checkout root plus sub-folders (2 levels) that have their own build manifest."""
    manifests = ("package.json", "pom.xml", "build.gradle", "build.gradle.kts", "requirements.txt",
                 "pyproject.toml", "pytest.ini", "setup.cfg", "tox.ini")
    roots = [repo]
    for depth_one in sorted(p for p in repo.iterdir() if p.is_dir()) if repo.is_dir() else []:
        if depth_one.name in _SKIP_DIRS or depth_one.name.startswith("."):
            continue
        for candidate in [depth_one, *sorted(p for p in depth_one.iterdir() if p.is_dir())]:
            if candidate.name in _SKIP_DIRS or candidate.name.startswith("."):
                continue
            if (candidate / "bruno.json").is_file():
                continue
            if any((candidate / m).is_file() for m in manifests):
                roots.append(candidate)
    return roots[:25]


def detect(repo: Path) -> list[Framework]:
    repo = repo.resolve()
    frameworks: list[Framework] = []
    for root in _project_roots(repo):
        rel_root = "." if root == repo else _rel(root, repo)
        files = list(_walk(root))
        frameworks += _detect_node(repo, root, rel_root, files)
        frameworks += _detect_java(repo, root, rel_root, files)
        frameworks += _detect_python(repo, root, rel_root, files)
    return [f for f in frameworks if f.targets]


def _detect_node(repo: Path, root: Path, rel_root: str, files: list[Path]) -> list[Framework]:
    package_path = root / "package.json"
    k6_scripts = [f for f in files if f.suffix == ".js" and _K6_IMPORT.search(_read(f, 4096))]
    results: list[Framework] = []
    has_node, has_npx = bool(shutil.which("node")), bool(shutil.which("npx"))

    if k6_scripts:
        fw = Framework(f"k6@{rel_root}", "k6", "javascript", rel_root, "k6", ["Performance"])
        _missing(fw, "k6", bool(scaffold_service.tool_path("k6")))
        for script in k6_scripts[:MAX_FILE_TARGETS]:
            rel = _rel(script, root)
            fw.add(f"script|{rel}", rel, "Scripts", {"kind": "k6", "script": rel})
        results.append(fw)

    if not package_path.is_file():
        return results
    try:
        package = json.loads(_read(package_path))
    except ValueError:
        return results
    deps = {**(package.get("dependencies") or {}), **(package.get("devDependencies") or {})}
    scripts = package.get("scripts") or {}
    installed = (root / "node_modules").is_dir()
    stacks = [label for dep, label in (("selenium-webdriver", "Selenium WebDriver"), ("webdriverio", "WebdriverIO"),
                                       ("appium", "Appium"), ("@playwright/test", "Playwright"),
                                       ("cypress", "Cypress"), ("newman", "Postman")) if dep in deps]
    if "webdriverio" in deps and any("appium:" in _read(f, 20000) for f in files if f.suffix in (".js", ".ts")):
        stacks.append("Appium")
    stacks = list(dict.fromkeys(stacks))

    def node_framework(key: str, name: str, runner: str) -> Framework:
        fw = Framework(f"{key}@{rel_root}", name, "javascript", rel_root, runner, stacks)
        _missing(fw, "node", has_node)
        _missing(fw, "npx", has_npx)
        if not installed:
            fw.issues.append("Dependencies are not installed (no node_modules). Run 'Install dependencies' first.")
        fw.add("setup|npm-install", "Install dependencies (npm install)", "Setup", {"kind": "npm-install"})
        return fw

    js_files = [f for f in files if f.suffix in (".js", ".ts", ".mjs", ".cjs", ".jsx", ".tsx")]

    if "@playwright/test" in deps:
        fw = node_framework("playwright", "Playwright", "Playwright Test")
        fw.add("all", "All tests", "Run tests", {"kind": "playwright"})
        for spec in [f for f in js_files if _JS_TEST_SUFFIX.search(f.name)][:MAX_FILE_TARGETS]:
            rel = _rel(spec, root)
            fw.add(f"file|{rel}", rel, "Test files", {"kind": "playwright", "file": rel})
        fw.add("setup|browsers", "Install browsers (npx playwright install)", "Setup", {"kind": "playwright-install"})
        results.append(fw)

    if "cypress" in deps:
        fw = node_framework("cypress", "Cypress", "Cypress")
        fw.add("all", "All specs", "Run tests", {"kind": "cypress"})
        for spec in [f for f in js_files if _CY_SPEC.search(f.name)][:MAX_FILE_TARGETS]:
            rel = _rel(spec, root)
            fw.add(f"spec|{rel}", rel, "Test files", {"kind": "cypress", "spec": rel})
        results.append(fw)

    if "@wdio/cli" in deps:
        fw = node_framework("wdio", "WebdriverIO", "WDIO test runner")
        configs = sorted(_rel(f, root) for f in js_files if _WDIO_CONF.match(f.name))
        for config in configs:
            fw.add(f"config|{config}", f"All specs ({config})", "Run tests", {"kind": "wdio", "config": config})
        if configs:
            specs = [f for f in js_files
                     if (_WDIO_SPEC.search(f.name) and "spec" in f.parent.as_posix())
                     or f.name.endswith((".e2e.js", ".e2e.ts"))]
            for spec in specs[:MAX_FILE_TARGETS]:
                rel = _rel(spec, root)
                fw.add(f"spec|{rel}", rel, "Test files", {"kind": "wdio", "config": configs[0], "spec": rel})
        results.append(fw)
    elif "mocha" in deps:
        name = " + ".join(s for s in stacks if s in ("Selenium WebDriver", "Appium")) or "Mocha"
        fw = node_framework("mocha", name, "Mocha")
        fw.add("all", "All tests", "Run tests", {"kind": "mocha"})
        test_dirs = ("test", "tests", "spec", "specs")
        for spec in [f for f in js_files if _rel(f, root).split("/")[0] in test_dirs][:MAX_FILE_TARGETS]:
            rel = _rel(spec, root)
            fw.add(f"file|{rel}", rel, "Test files", {"kind": "mocha", "file": rel})
        results.append(fw)

    if "jest" in deps:
        fw = node_framework("jest", "Jest", "Jest")
        fw.add("all", "All tests", "Run tests", {"kind": "jest"})
        for spec in [f for f in js_files if _JS_TEST_SUFFIX.search(f.name)][:MAX_FILE_TARGETS]:
            rel = _rel(spec, root)
            fw.add(f"file|{rel}", rel, "Test files", {"kind": "jest", "file": rel})
        results.append(fw)

    collections = sorted(_rel(f, root) for f in files if f.name.endswith(".postman_collection.json"))
    if collections:
        environments = sorted(_rel(f, root) for f in files if f.name.endswith(".postman_environment.json"))
        fw = node_framework("newman", "Postman (Newman)", "Newman")
        newman_ok = (root / "node_modules" / ".bin" / ("newman.cmd" if os.name == "nt" else "newman")).exists() \
            or bool(shutil.which("newman"))
        _missing(fw, "newman", newman_ok)
        for collection in collections[:MAX_FILE_TARGETS]:
            name = Path(collection).name.removesuffix(".postman_collection.json")
            if not environments:
                fw.add(f"collection|{collection}", name, "Collections", {"kind": "newman", "collection": collection},
                       collection)
            for environment in environments[:10]:
                env_name = Path(environment).name.removesuffix(".postman_environment.json")
                fw.add(f"collection|{collection}|{environment}", f"{name} · {env_name}", "Collections",
                       {"kind": "newman", "collection": collection, "environment": environment}, collection)
        results.append(fw)

    runnable_scripts = {k: v for k, v in scripts.items() if not _NPM_LIFECYCLE.match(k)}
    if runnable_scripts:
        fw = node_framework("npm", "npm scripts", "npm")
        for name, command in runnable_scripts.items():
            fw.add(f"script|{name}", f"npm run {name}", "npm scripts", {"kind": "npm-script", "script": name},
                   str(command)[:200])
        results.append(fw)
    return results


def _detect_java(repo: Path, root: Path, rel_root: str, files: list[Path]) -> list[Framework]:
    pom = root / "pom.xml"
    gradle = next((root / n for n in ("build.gradle.kts", "build.gradle") if (root / n).is_file()), None)
    if not pom.is_file() and not gradle:
        return []
    build_text = _read(pom) if pom.is_file() else _read(gradle) if gradle else ""
    stacks = [label for needle, label in (
        ("io.appium", "Appium"), ("org.seleniumhq.selenium", "Selenium"), ("com.microsoft.playwright", "Playwright"),
        ("io.rest-assured", "RestAssured"), ("karate", "Karate"), ("io.cucumber", "Cucumber"),
        ("org.testng", "TestNG"), ("org.junit.jupiter", "JUnit 5"), ("junit:junit", "JUnit 4"),
    ) if needle in build_text]
    if "<artifactId>junit</artifactId>" in build_text and "JUnit 4" not in stacks and "JUnit 5" not in stacks:
        stacks.append("JUnit 4")
    test_sources = [f for f in files if f.suffix in (".java", ".kt") and "/src/test/" in f"/{_rel(f, root)}"]
    classes = []
    for source in test_sources:
        text = _read(source, 200 * 1024)
        if any(marker in text for marker in _JAVA_TEST_MARKERS) and not re.search(r"\babstract\s+class\b", text):
            package = re.search(r"^\s*package\s+([\w.]+)", text, re.M)
            fqn = f"{package.group(1)}.{source.stem}" if package else source.stem
            classes.append((source.stem, fqn, _rel(source, root)))
    classes.sort()

    if pom.is_file():
        wrapper = _wrapper(root, repo, ("mvnw.cmd", "mvnw") if os.name == "nt" else ("mvnw",))
        fw = Framework(f"maven@{rel_root}", "Maven" + (f" · {' + '.join(stacks)}" if stacks else ""), "java",
                       rel_root, "Maven Surefire", stacks)
        _missing(fw, "mvn", bool(wrapper or shutil.which("mvn")))
        fw.add("all", "All tests (mvn test)", "Run tests", {"kind": "maven"})
        hardcoded_suites = "<suiteXmlFiles>" in build_text
        if not hardcoded_suites:
            for suite in sorted(f for f in files if f.suffix == ".xml" and "<suite" in _read(f, 4096)
                                and "testng" in _read(f, 4096).lower())[:30]:
                rel = _rel(suite, root)
                fw.add(f"suite|{rel}", rel, "TestNG suites", {"kind": "maven", "suite": rel})
        for simple, _fqn, rel in classes[:MAX_FILE_TARGETS]:
            fw.add(f"class|{simple}", simple, "Test classes", {"kind": "maven", "test": simple}, rel)
        fw.add("setup|compile", "Download dependencies & compile (mvn test-compile)", "Setup",
               {"kind": "maven-compile"})
        return [fw]

    wrapper = _wrapper(root, repo, ("gradlew.bat",) if os.name == "nt" else ("gradlew",))
    fw = Framework(f"gradle@{rel_root}", "Gradle" + (f" · {' + '.join(stacks)}" if stacks else ""), "java",
                   rel_root, "Gradle test", stacks)
    _missing(fw, "gradle", bool(wrapper or shutil.which("gradle")))
    fw.add("all", "All tests (gradle test)", "Run tests", {"kind": "gradle"})
    for _simple, fqn, rel in classes[:MAX_FILE_TARGETS]:
        fw.add(f"class|{fqn}", fqn, "Test classes", {"kind": "gradle", "test": fqn}, rel)
    return [fw]


def _detect_python(repo: Path, root: Path, rel_root: str, files: list[Path]) -> list[Framework]:
    py_tests = [f for f in files if f.suffix == ".py" and (f.name.startswith("test_") or f.stem.endswith("_test"))]
    robot_files = [f for f in files if f.suffix == ".robot" and "*** test case" in _read(f, 64 * 1024).lower()]
    requirements = " ".join(_read(root / n).lower() for n in ("requirements.txt", "pyproject.toml", "setup.cfg"))
    has_conftest = any(f.name == "conftest.py" for f in files)
    uses_pytest = bool(py_tests) and ("pytest" in requirements or (root / "pytest.ini").is_file() or has_conftest)
    if not uses_pytest and not robot_files:
        return []
    venv = _venv_python(root)
    python = str(venv) if venv else scaffold_service.tool_path("python")
    stacks = [label for needle, label in (("playwright", "Playwright"), ("selenium", "Selenium"),
                                          ("appium", "Appium"), ("requests", "requests")) if needle in requirements]
    results = []

    def python_framework(key: str, name: str, runner: str, module: str) -> Framework:
        fw = Framework(f"{key}@{rel_root}", name, "python", rel_root, runner, stacks)
        _missing(fw, "python", bool(python))
        if not venv:
            fw.add("setup|venv", "Create virtual environment (.venv)", "Setup", {"kind": "venv"})
            fw.issues.append("No .venv found; tests use the station's Python. Create a .venv and install the "
                             "requirements to isolate dependencies.")
        elif (root / "requirements.txt").is_file():
            fw.add("setup|pip", "Install requirements into .venv", "Setup", {"kind": "pip"})
        if python and not _python_has(python, module):
            fw.issues.append(f"'{module}' is not installed for {python}. "
                             + ("Run 'Install requirements into .venv'." if venv else "Create a .venv first."))
        return fw

    if uses_pytest:
        fw = python_framework("pytest", "pytest" + (f" · {' + '.join(stacks)}" if stacks else ""), "pytest", "pytest")
        fw.add("all", "All tests", "Run tests", {"kind": "pytest"})
        for test in sorted(py_tests, key=lambda p: _rel(p, root))[:MAX_FILE_TARGETS]:
            rel = _rel(test, root)
            fw.add(f"file|{rel}", rel, "Test files", {"kind": "pytest", "file": rel})
        results.append(fw)
    if robot_files:
        fw = python_framework("robot", "Robot Framework", "Robot Framework", "robot")
        folders = sorted({_rel(f.parent, root) if f.parent != root else "." for f in robot_files})
        top = "tests" if (root / "tests").is_dir() and any(_rel(f, root).startswith("tests/") for f in robot_files) \
            else "."
        fw.add("all", f"All suites ({top})", "Run tests", {"kind": "robot", "path": top})
        for folder in folders[:30]:
            if folder != top:
                fw.add(f"folder|{folder}", f"{folder}/", "Suites", {"kind": "robot", "path": folder})
        for robot in sorted(robot_files, key=lambda p: _rel(p, root))[:MAX_FILE_TARGETS]:
            rel = _rel(robot, root)
            fw.add(f"file|{rel}", rel, "Test files", {"kind": "robot", "path": rel})
        results.append(fw)
    return results


# ── Run plans ────────────────────────────────────────────────────────────────

def _tool(name: str) -> str:
    path = scaffold_service.tool_path(name)
    if not path:
        raise ValueError(f"'{name}' was not found on this station. {_HINTS.get(name, '')}".strip())
    return path


def _split_extra(extra_args: str | None) -> list[str]:
    extra_args = (extra_args or "").strip()
    if not extra_args:
        return []
    if len(extra_args) > MAX_EXTRA_ARGS_LENGTH:
        raise ValueError("Extra arguments are too long.")
    try:
        return shlex.split(extra_args, posix=os.name != "nt")
    except ValueError as exc:
        raise ValueError(f"Could not parse the extra arguments: {exc}") from exc


def build_plan(repo: Path, target_id: str, artifact_dir: Path, extra_args: str | None = None,
               extra_env: dict[str, str] | None = None) -> RunPlan:
    """How to run a target. ``extra_env`` are the variables of the run's environment (BASE_URL, …)."""
    repo = repo.resolve()
    framework = next((f for f in detect(repo) if target_id in f.recipes), None)
    if not framework:
        raise ValueError("The selected target is no longer present in the linked checkout. Re-detect and try again.")
    recipe = framework.recipes[target_id]
    target = next(t for t in framework.targets if t.id == target_id)
    root = (repo / framework.root).resolve() if framework.root != "." else repo
    kind = recipe["kind"]
    extra = _split_extra(extra_args)
    junit_dir = artifact_dir / "junit"
    env = scaffold_service.job_environment()
    env.update({key: str(value) for key, value in (extra_env or {}).items()})
    seed: dict = {
        "kind": "framework", "framework": framework.name, "framework_id": framework.id, "language": framework.language,
        "runner": framework.runner, "stacks": framework.stacks, "target": target_id, "target_label": target.label,
        "group": target.group, "root": framework.root, "parser": None, "junit": [], "reports": [],
        "k6_summary": None, "setup": target.group == "Setup",
    }
    junit_dir_glob = {"dir": str(junit_dir), "pattern": "*.xml", "since": False}

    def npx(*args: str) -> list[str]:
        return [_tool("npx"), "--no-install", *args]

    if kind == "npm-install":
        argv = [_tool("npm"), "install", "--no-audit", "--no-fund"]
    elif kind == "npm-script":
        argv = [_tool("npm"), "run", recipe["script"], *(["--", *extra] if extra else [])]
        extra = []
        seed["parser"] = "auto"
    elif kind == "playwright-install":
        argv = npx("playwright", "install")
    elif kind == "playwright":
        junit_file = junit_dir / "playwright.xml"
        html_dir = artifact_dir / "playwright-report"
        env.update({"PLAYWRIGHT_JUNIT_OUTPUT_NAME": str(junit_file), "PLAYWRIGHT_HTML_OUTPUT_DIR": str(html_dir),
                    "PLAYWRIGHT_HTML_REPORT": str(html_dir), "PLAYWRIGHT_HTML_OPEN": "never"})
        argv = npx("playwright", "test", *([recipe["file"]] if recipe.get("file") else []),
                   "--reporter=list,junit,html")
        seed["junit"] = [junit_dir_glob]
        seed["reports"] = [str(html_dir / "index.html")]
        seed["parser"] = "playwright"
    elif kind == "cypress":
        argv = npx("cypress", "run", *(["--spec", recipe["spec"]] if recipe.get("spec") else []),
                   "--reporter", "junit", "--reporter-options", f"mochaFile={junit_dir / 'cypress-[hash].xml'}")
        seed["junit"] = [junit_dir_glob]
    elif kind == "wdio":
        argv = npx("wdio", "run", recipe["config"], *(["--spec", recipe["spec"]] if recipe.get("spec") else []))
        seed["parser"] = "wdio"
    elif kind == "mocha":
        argv = npx("mocha", *([recipe["file"]] if recipe.get("file") else []))
        seed["parser"] = "mocha"
    elif kind == "jest":
        argv = npx("jest", "--ci", *([recipe["file"]] if recipe.get("file") else []))
        seed["parser"] = "jest"
    elif kind == "newman":
        local = root / "node_modules" / ".bin" / ("newman.cmd" if os.name == "nt" else "newman")
        newman = [str(local)] if local.exists() else [_tool("newman")]
        argv = [*newman, "run", recipe["collection"],
                *(["-e", recipe["environment"]] if recipe.get("environment") else []),
                "-r", "cli,junit", "--reporter-junit-export", str(junit_dir / "newman.xml"), "--color", "off"]
        seed["junit"] = [junit_dir_glob]
    elif kind == "k6":
        summary = artifact_dir / "k6-summary.json"
        argv = [_tool("k6"), "run", "--summary-export", str(summary), recipe["script"]]
        seed["k6_summary"] = str(summary)
        seed["reports"] = [str(summary)]
    elif kind in ("maven", "maven-compile"):
        wrapper = _wrapper(root, repo, ("mvnw.cmd", "mvnw") if os.name == "nt" else ("mvnw",))
        mvn = str(wrapper) if wrapper else _tool("mvn")
        if kind == "maven-compile":
            argv = [mvn, "-B", "-ntp", "-Dstyle.color=never", "test-compile"]
        else:
            selector = []
            if recipe.get("test"):
                selector = [f"-Dtest={recipe['test']}", "-Dsurefire.failIfNoSpecifiedTests=false"]
            elif recipe.get("suite"):
                selector = [f"-Dsurefire.suiteXmlFiles={recipe['suite']}"]
            argv = [mvn, "-B", "-ntp", "-Dstyle.color=never", "test", *selector]
            seed["junit"] = [{"dir": str(root / "target" / "surefire-reports"), "pattern": "TEST-*.xml", "since": True}]
            seed["reports"] = [str(root / "target" / "surefire-reports" / "index.html")]
    elif kind == "gradle":
        wrapper = _wrapper(root, repo, ("gradlew.bat",) if os.name == "nt" else ("gradlew",))
        gradle = str(wrapper) if wrapper else _tool("gradle")
        argv = [gradle, "test", "--console=plain", *(["--tests", recipe["test"]] if recipe.get("test") else [])]
        seed["junit"] = [{"dir": str(root / "build" / "test-results"), "pattern": "**/*.xml", "since": True}]
        seed["reports"] = [str(root / "build" / "reports" / "tests" / "test" / "index.html")]
    elif kind == "venv":
        argv = [_tool("python"), "-m", "venv", ".venv"]
    elif kind == "pip":
        venv = _venv_python(root)
        if not venv:
            raise ValueError("Create the virtual environment (.venv) first.")
        argv = [str(venv), "-m", "pip", "install", "-r", "requirements.txt"]
    elif kind in ("pytest", "robot"):
        venv = _venv_python(root)
        python = str(venv) if venv else _tool("python")
        if kind == "pytest":
            argv = [python, "-m", "pytest", *([recipe["file"]] if recipe.get("file") else []),
                    f"--junitxml={junit_dir / 'pytest.xml'}", "-o", "junit_family=xunit2"]
            seed["junit"] = [junit_dir_glob]
        else:
            robot_dir = artifact_dir / "robot"
            argv = [python, "-m", "robot", "--outputdir", str(robot_dir), "--xunit", "xunit.xml",
                    "--consolecolors", "off", recipe["path"]]
            seed["junit"] = [{"dir": str(robot_dir), "pattern": "xunit.xml", "since": False}]
            seed["reports"] = [str(robot_dir / "report.html"), str(robot_dir / "log.html")]
    else:
        raise ValueError(f"Unsupported target kind '{kind}'.")

    argv += extra
    junit_dir.mkdir(parents=True, exist_ok=True)
    seed["command"] = argv
    seed["cwd"] = str(root)
    seed["technology"] = _technology(framework, root)
    label = f"{framework.name} · {target.label}" if target.group == "Run tests" else f"{framework.name}: {target.label}"
    warnings = [f"Missing on this station: {t['tool']} ({t['hint']})" for t in framework.missing_tools]
    if target.group != "Setup":
        warnings += framework.issues
    return RunPlan(argv, str(root), env, target_id, label, seed, warnings)


def _technology(framework: Framework, root: Path) -> dict:
    tech: dict = {"test_runner": framework.runner, "language": framework.language.capitalize()}
    if framework.stacks:
        tech["frameworks"] = ", ".join(framework.stacks)
    package = root / "package.json"
    if framework.language == "javascript" and package.is_file():
        try:
            data = json.loads(_read(package))
        except ValueError:
            data = {}
        deps = {**(data.get("dependencies") or {}), **(data.get("devDependencies") or {})}
        for dep in ("@playwright/test", "cypress", "webdriverio", "@wdio/cli", "mocha", "jest", "selenium-webdriver",
                    "newman"):
            if dep in deps:
                installed = root / "node_modules" / dep / "package.json"
                version = deps[dep]
                if installed.is_file():
                    try:
                        version = json.loads(_read(installed)).get("version") or version
                    except ValueError:
                        pass
                tech[dep] = version
        tech["build"] = "npm"
    elif framework.id.startswith("maven"):
        tech["build"] = "Maven"
    elif framework.id.startswith("gradle"):
        tech["build"] = "Gradle"
    return tech


# ── Results ──────────────────────────────────────────────────────────────────

def _junit_files(spec: dict, started: float) -> list[Path]:
    directory = Path(spec["dir"])
    if not directory.is_dir():
        return []
    files = directory.glob(spec["pattern"])
    return sorted(p for p in files if p.is_file() and (not spec.get("since") or p.stat().st_mtime >= started - 1))


def parse_junit(paths: list[Path]) -> list[dict]:
    """All <testcase> elements of the files, including nested suites (Robot, Cypress)."""
    results = []
    for path in paths:
        try:
            root = ET.fromstring(path.read_bytes())
        except (ET.ParseError, OSError):
            continue
        for case in root.iter("testcase"):
            failure = case.find("failure")
            error = case.find("error")
            skipped = case.find("skipped")
            problem = failure if failure is not None else error
            status = "failed" if problem is not None else "skipped" if skipped is not None else "passed"
            try:
                duration_ms = round(float(case.get("time") or 0) * 1000)
            except ValueError:
                duration_ms = None
            message = None
            if problem is not None:
                message = problem.get("message") or next(iter((problem.text or "").strip().splitlines()), "") or None
            results.append({
                "test_name": case.get("name") or "(unnamed)",
                "class_name": case.get("classname") or path.stem,
                "status": status,
                "duration_ms": duration_ms,
                "error_message": message[:2000] if message else None,
                "stack_trace": ((problem.text or "")[:8000] or None) if problem is not None else None,
            })
    return results


_SUMMARY_PATTERNS = {
    "mocha": {"passed": r"(\d+) passing", "failed": r"(\d+) failing", "skipped": r"(\d+) pending"},
    "playwright": {"passed": r"^\s*(\d+) passed", "failed": r"^\s*(\d+) failed", "skipped": r"^\s*(\d+) skipped"},
    "jest": {"passed": r"^Tests:.*?(\d+) passed", "failed": r"^Tests:.*?(\d+) failed",
             "skipped": r"^Tests:.*?(\d+) skipped"},
}


def _last(pattern: str, text: str) -> int:
    matches = re.findall(pattern, text, re.M)
    return int(matches[-1]) if matches else 0


def _summary_counts(parser: str, text: str) -> dict | None:
    if parser == "wdio":
        # The spec reporter prints one "N passing / M failing" block per spec file.
        counts = {key: sum(int(m) for m in re.findall(pattern, text, re.M))
                  for key, pattern in _SUMMARY_PATTERNS["mocha"].items()}
        if not (counts["passed"] or counts["failed"]):
            counts = {"passed": _last(r"Spec Files:\s+(\d+) passed", text),
                      "failed": _last(r"Spec Files:.*?(\d+) failed", text),
                      "skipped": _last(r"Spec Files:.*?(\d+) skipped", text)}
        return counts
    if parser == "bruno":
        totals = re.findall(r"Tests\s*│\s*(\d+)/(\d+)", text)
        if not totals:
            return None
        passed, total = map(int, totals[-1])
        return {"passed": passed, "failed": max(total - passed, 0), "skipped": 0}
    if parser in _SUMMARY_PATTERNS:
        return {key: _last(pattern, text) for key, pattern in _SUMMARY_PATTERNS[parser].items()}
    return None


def parse_console_summary(parser: str | None, log_text: str) -> dict | None:
    candidates = ["playwright", "mocha", "jest", "bruno", "wdio"] if parser == "auto" else [parser] if parser else []
    tail = "\n".join(log_text.splitlines()[-1500:])
    for name in candidates:
        counts = _summary_counts(name, tail)
        if counts and (counts["passed"] or counts["failed"]):
            return {"parser": name, **counts}
    return None


def parse_k6_summary(path: Path) -> list[dict]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    results = []

    def walk_group(group: dict, prefix: str = "") -> None:
        checks = group.get("checks") or {}
        for name, check in (checks.items() if isinstance(checks, dict) else ((c.get("name"), c) for c in checks)):
            fails = int(check.get("fails") or 0)
            total = fails + int(check.get("passes") or 0)
            results.append({"test_name": f"check: {name}", "class_name": prefix or "k6 checks",
                            "status": "failed" if fails else "passed", "duration_ms": None,
                            "error_message": f"{fails} of {total} failed" if fails else None,
                            "stack_trace": None})
        groups = group.get("groups") or {}
        for sub in (groups.values() if isinstance(groups, dict) else groups):
            walk_group(sub, f"{prefix}::{sub.get('name')}" if prefix else sub.get("name") or "")

    walk_group(data.get("root_group") or {})
    for metric, values in (data.get("metrics") or {}).items():
        for expression, outcome in (values.get("thresholds") or {}).items():
            ok = outcome.get("ok") if isinstance(outcome, dict) else not outcome
            results.append({"test_name": f"threshold: {metric} {expression}", "class_name": "k6 thresholds",
                            "status": "passed" if ok else "failed", "duration_ms": None,
                            "error_message": None if ok else "Threshold crossed", "stack_trace": None})
    return results


def k6_performance(path: Path) -> dict | None:
    """Response times, throughput and errors from a k6 --summary-export file, for the run view."""
    try:
        metrics = json.loads(path.read_text(encoding="utf-8")).get("metrics") or {}
    except (OSError, ValueError, AttributeError):
        return None
    duration = metrics.get("http_req_duration") or {}
    requests = metrics.get("http_reqs") or {}
    failed = metrics.get("http_req_failed") or {}
    vus = metrics.get("vus_max") or {}
    if not duration and not requests:
        return None

    def number(value) -> float | None:
        return round(float(value), 2) if isinstance(value, (int, float)) else None

    return {
        "p95_ms": number(duration.get("p(95)")),
        "p90_ms": number(duration.get("p(90)")),
        "avg_ms": number(duration.get("avg")),
        "max_ms": number(duration.get("max")),
        "requests": int(requests.get("count") or 0),
        "requests_per_second": number(requests.get("rate")),
        # http_req_failed is a rate: "value" in the summary export (older k6: "rate").
        "error_rate": number(failed.get("value", failed.get("rate"))),
        "virtual_users": int(vus.get("max") or vus.get("value") or 0),
        "iterations": int((metrics.get("iterations") or {}).get("count") or 0),
    }


def collect_results(seed: dict, artifact_dir: Path, started: float, exit_code: int | None) -> tuple[dict, dict]:
    """Return (counts + per-test results, run details) for a finished framework run."""
    log_path = artifact_dir / "process.log"
    log_text = log_path.read_text(encoding="utf-8", errors="replace") if log_path.is_file() else ""
    results: list[dict] = []
    source = "exit code"
    junit_paths = [p for spec in seed.get("junit") or [] for p in _junit_files(spec, started)]
    if junit_paths:
        results = parse_junit(junit_paths)
        source = "JUnit XML"
    if not results and seed.get("k6_summary"):
        results = parse_k6_summary(Path(seed["k6_summary"]))
        source = "k6 summary" if results else source

    summary = None
    if not results:
        summary = parse_console_summary(seed.get("parser"), log_text)
    if results:
        counts = {
            "passed": sum(r["status"] == "passed" for r in results),
            "failed": sum(r["status"] == "failed" for r in results),
            "skipped": sum(r["status"] == "skipped" for r in results),
        }
    elif summary:
        source = "console output"
        counts = {k: summary[k] for k in ("passed", "failed", "skipped")}
        ok = counts["failed"] == 0 and exit_code in (0, None)
        results = [{
            "test_name": seed.get("target_label") or "Run", "class_name": seed.get("framework") or "Run",
            "status": "passed" if ok else "failed", "duration_ms": None,
            "error_message": None if ok else f"{counts['failed']} failed, {counts['passed']} passed (see logs)",
            "stack_trace": None,
        }]
    else:
        ok = exit_code == 0
        results = [{
            "test_name": seed.get("target_label") or "Run", "class_name": seed.get("framework") or "Run",
            "status": "passed" if ok else "failed" if exit_code is not None else "error", "duration_ms": None,
            "error_message": None if ok else (f"Exit code {exit_code} (see logs)" if exit_code is not None
                                              else "The exit code is unknown (backend restarted during the run)."),
            "stack_trace": None,
        }]
        counts = {"passed": int(ok), "failed": int(not ok), "skipped": 0}

    parsed = {
        "test_results": results,
        "total_tests": counts["passed"] + counts["failed"] + counts["skipped"],
        "passed_tests": counts["passed"],
        "failed_tests": counts["failed"],
        "skipped_tests": counts["skipped"],
        "source": source,
    }

    report_files = [Path(p) for p in seed.get("reports") or []]
    report_files = [p for p in report_files if p.is_file() and p.stat().st_mtime >= started - 1]
    try:
        stored = _store_reports(report_files, artifact_dir / "reports")
    except OSError:
        stored = []
    details = {
        "type": "framework",
        "framework": seed.get("framework"),
        "command": seed.get("command") or [],
        "target": {"kind": "target", "name": seed.get("target_label"),
                   "file": seed.get("root") if seed.get("root") not in (None, ".") else None},
        "duration_seconds": round(time.time() - started, 1),
        "exit_code": exit_code,
        "results_source": source,
        "technology": seed.get("technology") or {},
        "reports": stored,
        "artifact_dir": str(artifact_dir),
    }
    if seed.get("k6_summary"):
        details["performance"] = k6_performance(Path(seed["k6_summary"]))
    return parsed, details


def _store_reports(paths: list[Path], target_dir: Path) -> list[dict]:
    stored = []
    target_dir.mkdir(parents=True, exist_ok=True)
    for index, path in enumerate(paths):
        destination = target_dir / f"{index:02d}-{path.parent.name}-{path.name}"
        shutil.copy2(path, destination)
        stored.append({"name": f"{path.parent.name}/{path.name}", "source": str(path), "file": destination.name,
                       "kind": path.suffix.lower().lstrip("."), "size": destination.stat().st_size})
    return stored


def detect_public(repo: Path) -> dict:
    frameworks = detect(repo)
    return {"frameworks": [f.public() for f in frameworks], "station_tools": scaffold_service.station_tools()}
