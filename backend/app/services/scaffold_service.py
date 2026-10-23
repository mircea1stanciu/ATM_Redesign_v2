"""Generate ready-to-run starter automation projects from the templates in ``app/scaffolds``.

A starter is a minimal, working project for one framework + language pair (the same
frameworks and languages taught on the Upskilling page). It is written to a local folder,
git-initialised with a first commit, and can be verified with a background
"install & run sample tests" job whose output is streamed to the UI.
"""
from __future__ import annotations

import asyncio
import os
import re
import shutil
import ssl
import subprocess
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from app.services import station_tools_service

SCAFFOLD_ROOT = Path(__file__).resolve().parents[1] / "scaffolds"
STEP_TIMEOUT_SECONDS = 20 * 60
MAX_LOG_LINES = 5000


class ScaffoldError(Exception):
    pass


LANGUAGES = {"javascript": "JavaScript", "java": "Java", "python": "Python"}

# Same ids, names and categories as the Upskilling programs.
FRAMEWORKS = [
    {"id": "playwright", "name": "Playwright", "type": "web",
     "summary": "Modern, reliable cross-browser E2E automation"},
    {"id": "selenium", "name": "Selenium WebDriver", "type": "web",
     "summary": "Industry-standard browser automation"},
    {"id": "cypress", "name": "Cypress", "type": "web",
     "summary": "Developer-friendly end-to-end testing for web apps"},
    {"id": "webdriverio", "name": "WebdriverIO", "type": "web",
     "summary": "Web + mobile automation with one JS framework"},
    {"id": "appium", "name": "Appium", "type": "mobile",
     "summary": "Cross-platform mobile UI automation"},
    {"id": "bruno", "name": "Bruno", "type": "api",
     "summary": "Git-friendly API testing collections"},
    {"id": "postman", "name": "Postman", "type": "api",
     "summary": "API collections run with Newman"},
    {"id": "restassured", "name": "RestAssured", "type": "api",
     "summary": "Java's standard library for REST API tests"},
    {"id": "karate", "name": "Karate DSL", "type": "api",
     "summary": "BDD-style API testing"},
    {"id": "junit5", "name": "JUnit 5", "type": "api",
     "summary": "The standard Java test runner and assertions"},
    {"id": "robotframework", "name": "Robot Framework", "type": "keyword-driven",
     "summary": "Keyword-driven acceptance testing"},
    {"id": "k6", "name": "k6", "type": "performance",
     "summary": "Developer-centric load and performance testing"},
]


@dataclass(frozen=True)
class Template:
    framework: str
    language: str
    tools: tuple[str, ...]
    run: tuple[str, ...]  # commands shown in the README / UI
    verify: tuple[tuple[str, tuple[str, ...]], ...]  # (label, argv with {tool} placeholders)
    target: str  # what the sample tests talk to
    note: str = ""  # e.g. what the verify step does not cover


_NPM_INSTALL = ("Install dependencies", ("{npm}", "install", "--no-audit", "--no-fund"))
_NPM_TEST = ("Run sample tests", ("{npm}", "test"))
_MVN_TEST = ("Build and run sample tests", ("{mvn}", "-B", "-ntp", "test"))
_VENV = ("Create virtual environment", ("{python}", "-m", "venv", ".venv"))
_PIP = ("Install dependencies", ("{venv_python}", "-m", "pip", "install", "-q", "-r", "requirements.txt"))

_PY_SETUP = (
    "python -m venv .venv",
    "source .venv/bin/activate   # Windows: .venv\\Scripts\\activate",
    "pip install -r requirements.txt",
)
_WEB_TARGET = "Selenium's practice web form (https://www.selenium.dev/selenium/web/web-form.html)"
_API_TARGET = "https://jsonplaceholder.typicode.com"
_DEVICE_NOTE = ("The sample test needs a running Appium server and an Android emulator/device, so the check "
                "only installs dependencies and compiles/collects the tests. Start an emulator from "
                "Test Runs › Devices, run `appium`, then run the tests.")

TEMPLATES: dict[tuple[str, str], Template] = {
    ("playwright", "javascript"): Template(
        "playwright", "javascript", ("node", "npm"),
        ("npm install", "npx playwright install chromium", "npm test"),
        (_NPM_INSTALL, ("Install Chromium", ("{npx}", "playwright", "install", "chromium")), _NPM_TEST),
        _WEB_TARGET),
    ("playwright", "python"): Template(
        "playwright", "python", ("python",),
        (*_PY_SETUP, "python -m playwright install chromium", "pytest"),
        (_VENV, _PIP, ("Install Chromium", ("{venv_python}", "-m", "playwright", "install", "chromium")),
         ("Run sample tests", ("{venv_python}", "-m", "pytest"))),
        _WEB_TARGET),
    ("playwright", "java"): Template(
        "playwright", "java", ("java", "mvn"), ("mvn test", "mvn test -Dbrowser.channel=msedge   # use Edge instead"),
        (_MVN_TEST,), _WEB_TARGET,
        "Tests run on the installed Google Chrome (Playwright's 'chrome' channel); pass "
        "-Dbrowser.channel=msedge to use Microsoft Edge."),
    ("selenium", "java"): Template(
        "selenium", "java", ("java", "mvn"), ("mvn test",), (_MVN_TEST,), _WEB_TARGET,
        "Selenium Manager downloads a matching Chrome driver (and Chrome, if missing) automatically."),
    ("selenium", "python"): Template(
        "selenium", "python", ("python",), (*_PY_SETUP, "pytest"),
        (_VENV, _PIP, ("Run sample tests", ("{venv_python}", "-m", "pytest"))), _WEB_TARGET,
        "Selenium Manager downloads a matching Chrome driver (and Chrome, if missing) automatically."),
    ("selenium", "javascript"): Template(
        "selenium", "javascript", ("node", "npm"), ("npm install", "npm test"), (_NPM_INSTALL, _NPM_TEST),
        _WEB_TARGET, "Selenium Manager downloads a matching Chrome driver (and Chrome, if missing) automatically."),
    ("cypress", "javascript"): Template(
        "cypress", "javascript", ("node", "npm"), ("npm install", "npm test", "npm run open   # interactive runner"),
        (_NPM_INSTALL, _NPM_TEST), _WEB_TARGET),
    ("webdriverio", "javascript"): Template(
        "webdriverio", "javascript", ("node", "npm"), ("npm install", "npm test"), (_NPM_INSTALL, _NPM_TEST),
        _WEB_TARGET),
    ("appium", "java"): Template(
        "appium", "java", ("java", "mvn"), ("appium   # in another terminal", "mvn test"),
        (("Build and compile tests", ("{mvn}", "-B", "-ntp", "test-compile")),),
        "Android Settings app on emulator-5554", _DEVICE_NOTE),
    ("appium", "python"): Template(
        "appium", "python", ("python",), (*_PY_SETUP, "appium   # in another terminal", "pytest"),
        (_VENV, _PIP, ("Collect tests", ("{venv_python}", "-m", "pytest", "--collect-only", "-q"))),
        "Android Settings app on emulator-5554", _DEVICE_NOTE),
    ("appium", "javascript"): Template(
        "appium", "javascript", ("node", "npm"), ("npm install", "appium   # in another terminal", "npm test"),
        (_NPM_INSTALL, ("Load tests (dry run)", ("{npx}", "mocha", "--dry-run"))),
        "Android Settings app on emulator-5554", _DEVICE_NOTE),
    ("bruno", "javascript"): Template(
        "bruno", "javascript", ("node", "npm"), ("npm install", "npm test"), (_NPM_INSTALL, _NPM_TEST),
        _API_TARGET, "The collection is in collections/sample-api and can also be run from Test Runs › Local."),
    ("postman", "javascript"): Template(
        "postman", "javascript", ("node", "npm"), ("npm install", "npm test"), (_NPM_INSTALL, _NPM_TEST),
        _API_TARGET, "Import postman/*.json into the Postman app to edit the collection visually."),
    ("restassured", "java"): Template(
        "restassured", "java", ("java", "mvn"), ("mvn test",), (_MVN_TEST,), _API_TARGET),
    ("karate", "java"): Template(
        "karate", "java", ("java", "mvn"), ("mvn test",), (_MVN_TEST,), _API_TARGET),
    ("junit5", "java"): Template(
        "junit5", "java", ("java", "mvn"), ("mvn test",), (_MVN_TEST,), "a sample PriceCalculator class"),
    ("robotframework", "python"): Template(
        "robotframework", "python", ("python",), (*_PY_SETUP, "robot --outputdir reports tests"),
        (_VENV, _PIP, ("Run sample tests", ("{venv_python}", "-m", "robot", "--outputdir", "reports", "tests"))),
        _API_TARGET),
    ("k6", "javascript"): Template(
        "k6", "javascript", ("k6",), ("k6 run scripts/smoke.js", "k6 run scripts/load.js   # load test"),
        (("Run smoke test", ("{k6}", "run", "scripts/smoke.js")),), _API_TARGET,
        "k6 is a standalone binary: install it from https://grafana.com/docs/k6/latest/set-up/install-k6/"),
}

_TOOL_HINTS = {
    "node": "Install Node.js LTS from https://nodejs.org",
    "npm": "npm ships with Node.js",
    "java": "Install a JDK 17+ (e.g. https://adoptium.net)",
    "mvn": "Install Apache Maven from https://maven.apache.org",
    "python": "Install Python 3.10+ from https://www.python.org",
    "k6": "Install k6 from https://grafana.com/docs/k6/latest/set-up/install-k6/",
}


# ── Station tools ────────────────────────────────────────────────────────────

_CA_BUNDLE = Path(tempfile.gettempdir()) / "atm-station-ca-bundle.pem"
_LINUX_BUNDLES = ("/etc/ssl/certs/ca-certificates.crt", "/etc/pki/tls/certs/ca-bundle.crt", "/etc/ssl/cert.pem")


def station_ca_bundle() -> str | None:
    """PEM file with the certificates this station trusts (public certificates only).

    Node and Python's ``requests`` ship their own CA lists and ignore the OS trust store, so
    behind a TLS-inspecting corporate proxy they reject every HTTPS download. Pointing
    NODE_EXTRA_CA_CERTS / REQUESTS_CA_BUNDLE at this bundle makes them trust what the OS trusts.
    """
    if sys.platform.startswith("linux"):
        return next((b for b in _LINUX_BUNDLES if Path(b).is_file()), None)
    if _CA_BUNDLE.is_file() and time.time() - _CA_BUNDLE.stat().st_mtime < 24 * 3600:
        return str(_CA_BUNDLE)
    pems: list[str] = []
    try:
        if sys.platform == "darwin":
            keychains = ["/System/Library/Keychains/SystemRootCertificates.keychain",
                         "/Library/Keychains/System.keychain",
                         str(Path.home() / "Library/Keychains/login.keychain-db")]
            for keychain in keychains:
                if Path(keychain).exists():
                    out = subprocess.run(["security", "find-certificate", "-a", "-p", keychain],
                                         capture_output=True, text=True, timeout=30, check=False)
                    pems.append(out.stdout)
        elif os.name == "nt":
            for store in ("ROOT", "CA"):
                for cert, encoding, _trust in ssl.enum_certificates(store):  # type: ignore[attr-defined]
                    if encoding == "x509_asn":
                        pems.append(ssl.DER_cert_to_PEM_cert(cert))
    except (OSError, subprocess.SubprocessError):
        return None
    bundle = "\n".join(p.strip() for p in pems if "BEGIN CERTIFICATE" in p)
    if not bundle:
        return None
    _CA_BUNDLE.write_text(bundle + "\n", encoding="ascii", errors="ignore")
    return str(_CA_BUNDLE)


def job_environment() -> dict[str, str]:
    env = dict(os.environ, CI="1", NO_COLOR="1", FORCE_COLOR="0", PIP_DISABLE_PIP_VERSION_CHECK="1",
               PYTHONUNBUFFERED="1")
    bundle = station_ca_bundle()
    if bundle:
        for name in ("NODE_EXTRA_CA_CERTS", "REQUESTS_CA_BUNDLE", "SSL_CERT_FILE"):
            env.setdefault(name, bundle)
    return env


def _python_executable() -> str | None:
    for name in ("python3", "python", "py"):
        found = shutil.which(name)
        # Skip the Windows Store "python" stub, which only opens the Store.
        if found and "WindowsApps" not in found:
            return found
    return None


def tool_path(tool: str) -> str | None:
    if tool == "python":
        return _python_executable()
    return shutil.which(tool) or station_tools_service.managed_path(tool)


def station_tools() -> dict[str, bool]:
    return {tool: bool(tool_path(tool)) for tool in ("node", "npm", "java", "mvn", "python", "k6")}


def catalog() -> dict:
    tools = station_tools()
    frameworks = []
    for fw in FRAMEWORKS:
        options = []
        for (framework, language), tpl in TEMPLATES.items():
            if framework != fw["id"]:
                continue
            missing = [t for t in tpl.tools if not tools.get(t)]
            options.append({
                "language": language,
                "language_name": LANGUAGES[language],
                "tools": list(tpl.tools),
                "missing_tools": [{"tool": t, "hint": _TOOL_HINTS.get(t, ""),
                                   "installable": station_tools_service.is_installable(t)} for t in missing],
                "run": list(tpl.run),
                "target": tpl.target,
                "note": tpl.note,
                "files": sorted(_template_files(framework, language)),
            })
        options.sort(key=lambda o: list(LANGUAGES).index(str(o["language"])))
        frameworks.append({**fw, "languages": options})
    # Tools ATM installed in its own folder: not on the user's PATH, so terminals won't find them.
    managed = {t: station_tools_service.managed_path(t) for t in station_tools_service.INSTALLABLE
               if not shutil.which(t) and station_tools_service.managed_path(t)}
    return {"frameworks": frameworks, "languages": LANGUAGES, "station_tools": tools, "managed_tools": managed}


# ── Creating a project ───────────────────────────────────────────────────────

def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return slug[:60] or "automation-project"


def _template_dir(framework: str, language: str) -> Path:
    if (framework, language) not in TEMPLATES:
        raise ScaffoldError(f"No starter template for {framework} with {LANGUAGES.get(language, language)}.")
    return SCAFFOLD_ROOT / f"{framework}-{language}"


def _template_files(framework: str, language: str) -> list[str]:
    root = _template_dir(framework, language)
    return [p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()]


def resolve_target(path: Path, project_name: str) -> Path:
    """Use ``path`` if it is missing or empty, otherwise a ``<slug>`` subfolder inside it."""
    def usable(candidate: Path) -> bool:
        if not candidate.exists():
            return True
        if not candidate.is_dir():
            raise ScaffoldError(f"'{candidate}' is a file, not a folder.")
        return not any(candidate.iterdir())

    if usable(path):
        return path
    nested = path / slugify(project_name)
    if usable(nested):
        return nested
    raise ScaffoldError(f"'{path}' and '{nested}' already contain files. Choose an empty or new folder.")


def render_readme(project_name: str, framework: str, language: str) -> str:
    tpl = TEMPLATES[(framework, language)]
    fw = next(f for f in FRAMEWORKS if f["id"] == framework)
    lines = [
        f"# {project_name}",
        "",
        f"Starter **{fw['name']}** automation project in **{LANGUAGES[language]}**, generated by ATM "
        "(AutomationTestManager). It is configured and runs out of the box; replace the sample tests with "
        "tests for your application.",
        "",
        f"The sample tests target {tpl.target}.",
        "",
        "## Prerequisites",
        "",
        *[f"- `{t}` – {_TOOL_HINTS.get(t, '')}" for t in tpl.tools],
        "",
        "## Run the tests",
        "",
        "```bash",
        *tpl.run,
        "```",
        "",
    ]
    if tpl.note:
        lines += ["## Notes", "", tpl.note, ""]
    if language in ("javascript", "python"):
        lines += [
            "## Behind a corporate proxy",
            "",
            "If downloads or HTTPS requests fail with `unable to get local issuer certificate`, your network "
            "inspects TLS traffic. Export your company's root certificate (or all trusted certificates) to a "
            "PEM file and point the tools at it:",
            "",
            "```bash",
            "export NODE_EXTRA_CA_CERTS=/path/to/company-ca.pem   # Node.js, npm, Playwright, Cypress",
            "export REQUESTS_CA_BUNDLE=/path/to/company-ca.pem    # Python requests",
            "```",
            "",
            "ATM sets these automatically when it runs the project for you.",
            "",
        ]
    lines += ["## Project structure", "", "```", *sorted(_template_files(framework, language)), "```", ""]
    return "\n".join(lines)


def _git(cwd: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=cwd, text=True, capture_output=True, check=False)


def create_project(path: Path, framework: str, language: str, project_name: str,
                   author_name: str = "", author_email: str = "") -> Path:
    """Write the starter into ``path`` (created if missing), git init and commit. Returns the folder used."""
    source = _template_dir(framework, language)
    target = resolve_target(path, project_name)
    replacements = {"__PROJECT_NAME__": project_name.strip() or "Automation project",
                    "__PROJECT_SLUG__": slugify(project_name)}
    target.mkdir(parents=True, exist_ok=True)
    for file in sorted(source.rglob("*")):
        if not file.is_file():
            continue
        dest = target / file.relative_to(source)
        dest.parent.mkdir(parents=True, exist_ok=True)
        text = file.read_text(encoding="utf-8")
        for placeholder, value in replacements.items():
            text = text.replace(placeholder, value)
        dest.write_text(text, encoding="utf-8")
    (target / "README.md").write_text(render_readme(replacements["__PROJECT_NAME__"], framework, language),
                                      encoding="utf-8")

    init = _git(target, "init", "-b", "main")
    if init.returncode != 0:  # git < 2.28 has no -b
        _git(target, "init")
        _git(target, "checkout", "-b", "main")
    _git(target, "add", "-A")
    identity: list[str] = []
    if not _git(target, "config", "user.email").stdout.strip():
        identity = ["-c", f"user.name={author_name or 'ATM'}", "-c", f"user.email={author_email or 'atm@localhost'}"]
    fw_name = next(f["name"] for f in FRAMEWORKS if f["id"] == framework)
    commit = _git(target, *identity, "commit", "-q", "-m",
                  f"Initial {fw_name} ({LANGUAGES[language]}) starter project generated by ATM")
    if commit.returncode != 0:
        raise ScaffoldError(f"git commit failed: {(commit.stderr or commit.stdout).strip()[:300]}")
    return target


def git_remotes(folder: Path) -> list[str]:
    result = _git(folder, "remote")
    return [line for line in result.stdout.split() if line] if result.returncode == 0 else []


def delete_project(folder: Path) -> None:
    """Permanently delete a generated starter that was never connected to a remote repository."""
    folder = folder.resolve()
    home = Path.home().resolve()
    if len(folder.parts) < 3 or folder == home or folder in home.parents:
        raise ScaffoldError(f"Refusing to delete '{folder}'.")
    if not folder.exists():
        return
    if not (folder / ".git").is_dir():
        raise ScaffoldError(f"'{folder}' is not the generated git repository any more; delete it manually.")
    remotes = git_remotes(folder)
    if remotes:
        raise ScaffoldError(
            f"The project is connected to a remote repository ({', '.join(remotes)}), so it is not deleted here. "
            "Use Local and GIT project Management › Remove instead."
        )
    for job in list(_JOBS.values()):
        if job.path == str(folder) and job.status == "running":
            cancel_job(job.id)

    def make_writable_and_retry(func, path, _exc):
        # git marks object files read-only, which blocks deletion on Windows.
        os.chmod(path, 0o700)
        func(path)

    if sys.version_info >= (3, 12):
        shutil.rmtree(folder, onexc=make_writable_and_retry)
    else:
        shutil.rmtree(folder, onerror=make_writable_and_retry)


# ── Verify jobs (install & run the sample tests) ─────────────────────────────

@dataclass
class VerifyJob:
    id: str
    project_id: int
    path: str
    framework: str
    language: str
    steps: list[dict]
    status: str = "running"  # running | passed | failed | cancelled
    log: list[str] = field(default_factory=list)
    started_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    finished_at: str | None = None
    process: asyncio.subprocess.Process | None = None

    def to_dict(self, since: int = 0) -> dict:
        return {
            "id": self.id, "project_id": self.project_id, "path": self.path,
            "framework": self.framework, "language": self.language,
            "status": self.status, "steps": self.steps,
            "started_at": self.started_at, "finished_at": self.finished_at,
            "log_offset": since, "log": self.log[since:], "log_total": len(self.log),
        }


_JOBS: dict[str, VerifyJob] = {}


def _venv_python(folder: Path) -> str:
    scripts = folder / ".venv" / ("Scripts" if os.name == "nt" else "bin")
    return str(scripts / ("python.exe" if os.name == "nt" else "python"))


def _resolve_argv(argv: tuple[str, ...], folder: Path) -> list[str]:
    resolved = []
    for token in argv:
        match = re.fullmatch(r"\{(\w+)\}", token)
        if not match:
            resolved.append(token)
            continue
        name = match.group(1)
        value = _venv_python(folder) if name == "venv_python" else tool_path(name)
        if not value:
            raise ScaffoldError(f"'{name}' was not found on this station. {_TOOL_HINTS.get(name, '')}".strip())
        resolved.append(value)
    return resolved


def latest_job(project_id: int) -> VerifyJob | None:
    jobs = [j for j in _JOBS.values() if j.project_id == project_id]
    return max(jobs, key=lambda j: j.started_at) if jobs else None


def get_job(job_id: str) -> VerifyJob | None:
    return _JOBS.get(job_id)


def start_verify(project_id: int, folder: Path, framework: str, language: str) -> VerifyJob:
    tpl = TEMPLATES.get((framework, language))
    if not tpl:
        raise ScaffoldError("Unknown starter template.")
    if not folder.is_dir():
        raise ScaffoldError(f"'{folder}' does not exist any more.")
    running = latest_job(project_id)
    if running and running.status == "running":
        return running
    missing = [t for t in tpl.tools if not tool_path(t)]
    # Standalone tools (k6) are downloaded by the job itself; anything else must be installed by the user.
    installs = [t for t in missing if station_tools_service.is_installable(t)]
    blocking = [t for t in missing if t not in installs]
    if blocking:
        details = "; ".join(f"{t} ({_TOOL_HINTS.get(t, '')})" for t in blocking)
        raise ScaffoldError(f"Missing on this station: {details}")
    job = VerifyJob(uuid.uuid4().hex[:12], project_id, str(folder), framework, language,
                    [{"label": f"Install {t}", "status": "pending"} for t in installs]
                    + [{"label": label, "status": "pending"} for label, _ in tpl.verify])
    _JOBS[job.id] = job
    asyncio.get_running_loop().create_task(_run_job(job, tpl, folder, installs))
    return job


def _append(job: VerifyJob, text: str) -> None:
    job.log.append(text)
    if len(job.log) > MAX_LOG_LINES:
        del job.log[: len(job.log) - MAX_LOG_LINES]


async def _install_tools(job: VerifyJob, tools: list[str]) -> bool:
    for index, tool in enumerate(tools):
        step = job.steps[index]
        step["status"] = "running"
        _append(job, f"$ install {tool} ({station_tools_service.INSTALLABLE[tool]})")
        try:
            await station_tools_service.install(tool, lambda line: _append(job, line))
        except station_tools_service.ToolInstallError as exc:
            _append(job, f"✖ {exc}")
            step["status"] = "failed"
            return False
        except OSError as exc:
            _append(job, f"✖ Could not install {tool}: {exc}")
            step["status"] = "failed"
            return False
        if job.status == "cancelled":
            step["status"] = "cancelled"
            return False
        step["status"] = "passed"
        _append(job, f"✔ Install {tool}")
    return True


async def _run_job(job: VerifyJob, tpl: Template, folder: Path, installs: list[str] | None = None) -> None:
    installs = installs or []
    if not await _install_tools(job, installs):
        job.status = job.status if job.status == "cancelled" else "failed"
        job.finished_at = datetime.now(timezone.utc).isoformat()
        return
    env = await asyncio.to_thread(job_environment)
    for index, (label, argv) in enumerate(tpl.verify):
        step = job.steps[len(installs) + index]
        step["status"] = "running"
        try:
            command = _resolve_argv(argv, folder)
        except ScaffoldError as exc:
            _append(job, f"✖ {exc}")
            step["status"] = "failed"
            break
        _append(job, "$ " + " ".join([Path(command[0]).name, *command[1:]]))
        try:
            job.process = await asyncio.create_subprocess_exec(
                *command, cwd=str(folder), env=env,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                start_new_session=os.name != "nt",
            )
            assert job.process.stdout is not None

            async def pump() -> None:
                async for raw in job.process.stdout:  # type: ignore[union-attr]
                    _append(job, raw.decode(errors="replace").rstrip())

            await asyncio.wait_for(pump(), timeout=STEP_TIMEOUT_SECONDS)
            code = await job.process.wait()
        except asyncio.TimeoutError:
            if job.process:
                job.process.kill()
            _append(job, f"✖ {label} timed out after {STEP_TIMEOUT_SECONDS // 60} minutes")
            code = -1
        except OSError as exc:
            _append(job, f"✖ Could not start {command[0]}: {exc}")
            code = -1
        if job.status == "cancelled":
            step["status"] = "cancelled"
            break
        step["status"] = "passed" if code == 0 else "failed"
        if code != 0:
            _append(job, f"✖ {label} failed (exit code {code})")
            break
        _append(job, f"✔ {label}")
    job.process = None
    if job.status != "cancelled":
        job.status = "passed" if all(s["status"] == "passed" for s in job.steps) else "failed"
    job.finished_at = datetime.now(timezone.utc).isoformat()


def cancel_job(job_id: str) -> VerifyJob | None:
    job = _JOBS.get(job_id)
    if not job or job.status != "running":
        return job
    job.status = "cancelled"
    process = job.process
    if process and process.returncode is None:
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, check=False)
        else:
            import signal
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    _append(job, "✖ Cancelled by user")
    return job


__all__ = [
    "catalog", "create_project", "delete_project", "git_remotes", "start_verify", "get_job", "latest_job",
    "cancel_job", "ScaffoldError", "TEMPLATES", "FRAMEWORKS", "LANGUAGES", "slugify",
]
