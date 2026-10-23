"""Summarise a GitHub repository's test-automation setup from its file tree and
build manifests (pom.xml / package.json), for the Projects › Overview page."""
from __future__ import annotations

import json
import re
from collections import Counter

from app.services.framework_detector import FrameworkDetector

_SKIP_PARTS = {"target", "node_modules", "build", ".gradle", "dist", "out", ".idea"}
_POM_TAG = r"<{tag}>\s*([^<\s]+)\s*</{tag}>"

# (label, matcher) — counted over the repository's file paths.
_TEST_FILE_KINDS = [
    ("Cucumber feature files", lambda p: p.endswith(".feature")),
    ("Cucumber runners (Java)", lambda p: p.endswith("Runner.java") and "/test/" in f"/{p}"),
    ("Java test classes", lambda p: p.endswith(".java") and "src/test/java/" in p),
    ("Bruno requests", lambda p: p.endswith(".bru") and "/environments/" not in p and "/environment/" not in p),
    ("Python tests", lambda p: re.search(r"(^|/)(test_[^/]*|[^/]*_test)\.py$", p) is not None),
    ("JS/TS specs", lambda p: re.search(r"\.(spec|test|cy)\.(t|j)sx?$", p) is not None),
    ("Robot suites", lambda p: p.endswith(".robot")),
]

_BUILD_TOOLS = [
    ("Maven", lambda files: "pom.xml" in files),
    ("Gradle", lambda files: "build.gradle" in files or "build.gradle.kts" in files),
    ("npm", lambda files: "package.json" in files),
    ("Python", lambda files: bool({"requirements.txt", "pyproject.toml", "setup.py"} & files)),
    ("Bruno", lambda files: any(f == "bruno.json" or f.endswith("/bruno.json") for f in files)),
]

_DETECTOR_LABELS = {
    "pytest": "pytest", "junit": "JUnit", "playwright": "Playwright", "appium": "Appium",
    "cypress": "Cypress", "robot": "Robot Framework", "bruno": "Bruno",
}

_JS_TEST_LIBS = {
    "appium": "Appium",
    "webdriverio": "WebdriverIO",
    "@wdio/cli": "WebdriverIO",
    "@playwright/test": "Playwright",
    "playwright": "Playwright",
    "cypress": "Cypress",
    "jest": "Jest",
    "mocha": "Mocha",
    "@usebruno/cli": "Bruno CLI",
}


def _relevant(path: str) -> bool:
    return not (set(path.split("/")) & _SKIP_PARTS)


def summarize_pom(text: str) -> dict:
    def tag(name: str) -> str | None:
        match = re.search(_POM_TAG.format(tag=re.escape(name)), text)
        return match.group(1) if match else None

    def has_dependency(group_or_artifact: str) -> bool:
        return group_or_artifact in text

    stacks = []
    if has_dependency("io.appium"):
        stacks.append("Appium")
    if has_dependency("io.cucumber"):
        stacks.append("Cucumber")
    if has_dependency("org.testng"):
        stacks.append("TestNG")
    if has_dependency("org.junit") or has_dependency("<artifactId>junit</artifactId>"):
        stacks.append("JUnit")
    if has_dependency("org.seleniumhq.selenium"):
        stacks.append("Selenium")
    if has_dependency("io.rest-assured"):
        stacks.append("REST Assured")
    if has_dependency("io.qameta.allure"):
        stacks.append("Allure")
    return {
        "artifact": tag("artifactId"),
        "java_release": tag("maven.compiler.release") or tag("java.version") or tag("release"),
        "appium_java_client": tag("java-client.version"),
        "selenium": tag("selenium.version"),
        "stacks": stacks,
    }


def summarize_package_json(text: str) -> dict:
    try:
        data = json.loads(text)
    except ValueError:
        return {}
    deps = {**(data.get("dependencies") or {}), **(data.get("devDependencies") or {})}
    libs = {}
    for name, label in _JS_TEST_LIBS.items():
        if name in deps:
            libs[label] = str(deps[name])
    return {"name": data.get("name"), "test_libraries": libs, "scripts": sorted((data.get("scripts") or {}).keys())}


def analyze_tree(paths: list[str], pom_text: str | None = None, package_json_text: str | None = None) -> dict:
    files = [p for p in paths if _relevant(p)]
    file_set = set(files)
    counts = {label: sum(1 for p in files if match(p)) for label, match in _TEST_FILE_KINDS}

    pom = summarize_pom(pom_text) if pom_text else None
    package = summarize_package_json(package_json_text) if package_json_text else None

    frameworks: list[str] = []
    for name in FrameworkDetector.detect_frameworks(files):
        label = _DETECTOR_LABELS.get(name, name)
        # The file-name detector guesses JUnit for any src/test/java; trust pom.xml instead.
        if pom and label == "JUnit" and "JUnit" not in pom["stacks"]:
            continue
        frameworks.append(label)
    if pom:
        frameworks += pom["stacks"]
    if package:
        frameworks += list(package["test_libraries"].keys())
    if counts["Bruno requests"] and "Bruno" not in frameworks:
        frameworks.append("Bruno")
    # De-duplicate, keeping order.
    frameworks = list(dict.fromkeys(f for f in frameworks if f and f.lower() != "unknown"))

    top_dirs = Counter(p.split("/", 1)[0] for p in files if "/" in p)
    return {
        "files_count": len(files),
        "frameworks": frameworks,
        "build_tools": [label for label, present in _BUILD_TOOLS if present(file_set)],
        "test_files": {label: count for label, count in counts.items() if count},
        "collections": [c["path"] for c in FrameworkDetector.detect_projects(files)][:50],
        "properties_files": sorted(p for p in files if p.endswith(".properties"))[:50],
        "workflows": sorted(p.rsplit("/", 1)[-1] for p in files
                            if p.startswith(".github/workflows/") and p.endswith((".yml", ".yaml"))),
        "top_level_folders": [name for name, _ in top_dirs.most_common(12)],
        "has_readme": any(p.lower() in ("readme.md", "readme", "readme.rst") for p in files),
        "maven": pom,
        "package_json": package,
    }


def language_shares(languages: dict) -> list[dict]:
    total = sum(v for v in languages.values() if isinstance(v, (int, float))) or 0
    if not total:
        return []
    shares = [{"name": name, "percent": round(100 * bytes_ / total, 1)}
              for name, bytes_ in languages.items() if isinstance(bytes_, (int, float))]
    return sorted(shares, key=lambda s: -s["percent"])[:8]
