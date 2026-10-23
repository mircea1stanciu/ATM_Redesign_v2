"""Project analysis, AI prompt context, proposed file changes and chat storage for the
"AI Driven implementation" page.

* :func:`analyze` describes the linked local checkout (languages, frameworks, tests, structure, git).
* :func:`build_system_prompt` turns it into the context sent to the AI. Credential-like values are
  masked and key/certificate/.env files are never sent.
* The AI proposes files in ```file:<path> fenced blocks (:func:`parse_changes`); the user reviews a
  diff (:func:`preview_change`) and applies or undoes each file (:func:`apply_change`/:func:`undo_change`).
* Conversations are stored per user and project as JSON files outside the checkout.
"""
from __future__ import annotations

import difflib
import hashlib
import json
import re
import subprocess
import uuid
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from app.services import framework_run_service, github_overview_service
from app.services.properties_service import is_secret_key

MAX_SCAN_FILES = 20000
MAX_LISTED_FILES = 5000
MAX_ATTACHED_FILES = 12
MAX_FILE_CHARS = 30000
MAX_CONTEXT_CHARS = 160000
MAX_CHANGE_BYTES = 1024 * 1024
MAX_HISTORY_MESSAGES = 24
_SKIP_DIRS = framework_run_service._SKIP_DIRS | {".automationtestmanager"}
_SENSITIVE_NAME = re.compile(
    r"(^\.env(\..*)?$|\.(pem|key|p12|pfx|jks|keystore|der|crt|cer)$|^id_(rsa|dsa|ecdsa|ed25519)|^\.npmrc$|^\.netrc$"
    r"|^credentials(\.json)?$|^settings-security\.xml$)", re.I)
_SECRET_ASSIGNMENT = re.compile(
    r"""^(?P<lead>\s*["']?)(?P<key>[\w.\-]+)(?P<sep>["']?\s*[:=]\s*)(?P<q>["']?)(?P<value>.+?)(?P<trail>["']?,?\s*)$""")
_SECRET_XML = re.compile(r"<(?P<tag>[\w.\-]*(?:pass(?:word)?|pwd|secret|token|api[_-]?key|credential)[\w.\-]*)>"
                         r"(?P<value>[^<]+)</(?P=tag)>", re.I)
_URL_CREDENTIALS = re.compile(r"(?P<scheme>[a-z][\w+.\-]*://)(?P<user>[^/\s:@]+):(?P<password>[^/\s@]+)@", re.I)
_PLACEHOLDER = re.compile(r"^(\{\{.*\}\}|\$\{.*\}|process\.env|os\.environ|System\.(getenv|getProperty)|<.*>|\*+)",
                          re.I)
_LANGUAGES = {
    ".java": "Java", ".kt": "Kotlin", ".js": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
    ".jsx": "JavaScript", ".ts": "TypeScript", ".tsx": "TypeScript", ".py": "Python", ".robot": "Robot Framework",
    ".feature": "Gherkin", ".bru": "Bruno", ".cs": "C#", ".go": "Go", ".rb": "Ruby", ".groovy": "Groovy",
    ".xml": "XML", ".json": "JSON", ".yml": "YAML", ".yaml": "YAML", ".properties": "Properties",
    ".html": "HTML", ".css": "CSS", ".sql": "SQL", ".sh": "Shell", ".md": "Markdown",
}
_CODE_LANGUAGES = {"Java", "Kotlin", "JavaScript", "TypeScript", "Python", "Robot Framework", "Gherkin", "Bruno",
                   "C#", "Go", "Ruby", "Groovy"}
_CONFIG_FILES = (
    "package.json", "pom.xml", "build.gradle", "build.gradle.kts", "requirements.txt", "pyproject.toml",
    "pytest.ini", "setup.cfg", "playwright.config.js", "playwright.config.ts", "cypress.config.js",
    "cypress.config.ts", "wdio.conf.js", "wdio.conf.ts", "testng.xml", "karate-config.js", "tsconfig.json",
    ".mocharc.json", "jest.config.js", "jest.config.ts", "bruno.json", "conftest.py",
)
_TEST_FILE = re.compile(
    r"(\.(spec|test|cy|e2e)\.(c|m)?(j|t)sx?$|(^|/)test_[^/]+\.py$|_test\.py$|(Test|Tests|IT|Steps|Runner)\.(java|kt)$"
    r"|\.feature$|\.robot$|(^|/)(?!environments/)[^/]+\.bru$|\.postman_collection\.json$)")


class ProjectAIError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _git(repo: Path, *args: str) -> str:
    try:
        result = subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True, timeout=20, check=False)
    except (OSError, subprocess.SubprocessError):
        return ""
    return result.stdout.strip() if result.returncode == 0 else ""


# ── Files ────────────────────────────────────────────────────────────────────

def list_files(repo: Path) -> list[str]:
    """Project files relative to the checkout (build output, dependencies and VCS folders skipped)."""
    repo = repo.resolve()
    found: list[str] = []
    stack = [repo]
    while stack and len(found) < MAX_SCAN_FILES:
        directory = stack.pop()
        try:
            entries = sorted(directory.iterdir(), key=lambda p: p.name.lower(), reverse=True)
        except OSError:
            continue
        for entry in entries:
            if entry.is_symlink():
                continue
            if entry.is_dir():
                if entry.name not in _SKIP_DIRS and entry.name != ".git":
                    stack.append(entry)
            elif entry.is_file():
                found.append(entry.relative_to(repo).as_posix())
    return sorted(found)


def is_sensitive(rel_path: str) -> bool:
    return bool(_SENSITIVE_NAME.search(rel_path.rsplit("/", 1)[-1]))


def mask_secrets(text: str) -> str:
    """Replace values of credential-like keys (key=value, key: value, "key": "value") with ***."""
    lines = []
    for line in text.split("\n"):
        match = _SECRET_ASSIGNMENT.match(line)
        if match and is_secret_key(match.group("key")):
            value = match.group("value").strip()
            if value and not _PLACEHOLDER.match(value):
                line = (f"{match.group('lead')}{match.group('key')}{match.group('sep')}{match.group('q')}***"
                        f"{match.group('trail')}")
        lines.append(line)
    text = "\n".join(lines)
    text = _SECRET_XML.sub(lambda m: m.group(0) if _PLACEHOLDER.match(m.group("value").strip())
                           else f"<{m.group('tag')}>***</{m.group('tag')}>", text)
    return _URL_CREDENTIALS.sub(lambda m: f"{m.group('scheme')}{m.group('user')}:***@", text)


def resolve_project_path(repo: Path, rel_path: str) -> tuple[Path, str]:
    """Validate a path proposed by the user/AI and return (absolute path, normalised relative path)."""
    rel = (rel_path or "").strip().replace("\\", "/")
    while rel.startswith("./"):
        rel = rel[2:]
    parts = [p for p in rel.split("/") if p]
    if (not parts or rel.startswith("/") or re.match(r"^[A-Za-z]:", rel) or ".." in parts
            or parts[0] in (".git", ".automationtestmanager")):
        raise ProjectAIError(f"'{rel_path}' is not a valid path inside the project.")
    repo = repo.resolve()
    target = (repo / "/".join(parts)).resolve()
    try:
        target.relative_to(repo)
    except ValueError as exc:
        raise ProjectAIError(f"'{rel_path}' points outside the project.") from exc
    return target, target.relative_to(repo).as_posix()


def read_project_file(repo: Path, rel_path: str, limit: int = MAX_FILE_CHARS) -> tuple[str, bool]:
    """Masked file content for the AI and whether it was truncated."""
    path, rel = resolve_project_path(repo, rel_path)
    if is_sensitive(rel):
        raise ProjectAIError(f"'{rel}' looks like a secret/key file and is never sent to the AI.")
    if not path.is_file():
        raise ProjectAIError(f"'{rel}' does not exist.", 404)
    data = path.read_bytes()
    if b"\0" in data[:4096]:
        raise ProjectAIError(f"'{rel}' is a binary file.")
    text = mask_secrets(data.decode("utf-8", errors="replace"))
    return (text[:limit], True) if len(text) > limit else (text, False)


# ── Analysis ─────────────────────────────────────────────────────────────────

def analyze(repo: Path) -> dict:
    repo = repo.resolve()
    files = list_files(repo)
    by_language = Counter(_LANGUAGES[Path(f).suffix.lower()] for f in files if Path(f).suffix.lower() in _LANGUAGES)
    code_total = sum(n for lang, n in by_language.items() if lang in _CODE_LANGUAGES) or 1
    languages = [{"name": lang, "files": n, "percent": round(100 * n / code_total, 1)}
                 for lang, n in by_language.most_common() if lang in _CODE_LANGUAGES]

    def text_of(name: str) -> str | None:
        path = repo / name
        return path.read_text(encoding="utf-8", errors="replace") if path.is_file() else None

    overview = github_overview_service.analyze_tree(files, text_of("pom.xml"), text_of("package.json"))
    detection = framework_run_service.detect_public(repo)
    runnable = [{
        "name": f["name"], "root": f["root"], "runner": f["runner"], "language": f["language"],
        "stacks": f["stacks"], "missing_tools": [t["tool"] for t in f["missing_tools"]], "issues": f["issues"],
        "targets": sum(1 for t in f["targets"] if t["group"] != "Setup"),
    } for f in detection["frameworks"]]
    bruno = sorted(Path(f).parent.as_posix() for f in files if f.endswith("bruno.json"))
    from app.services.appium_project_service import detect_layout

    test_files = [f for f in files if _TEST_FILE.search(f)]
    top = Counter(f.split("/", 1)[0] if "/" in f else "(root)" for f in files)
    # ATM writes run artifacts into .automationtestmanager/; they are not the user's changes.
    status_lines = [line for line in _git(repo, "status", "--porcelain").splitlines()
                    if line.strip() and not line[3:].startswith(".automationtestmanager")]
    changed = [{"status": line[:2].strip() or "?", "path": line[3:]} for line in status_lines[:100]]
    last = _git(repo, "log", "-1", "--pretty=%h%n%an%n%ad%n%s", "--date=iso").splitlines()
    key_files = sorted({f for f in files if f.rsplit("/", 1)[-1] in _CONFIG_FILES or f.lower() == "readme.md"},
                       key=lambda p: (p.count("/"), p))[:40]
    return {
        "path": str(repo),
        "analyzed_at": _now(),
        "files_count": len(files),
        "files_truncated": len(files) >= MAX_SCAN_FILES,
        "languages": languages,
        "frameworks": overview["frameworks"],
        "build_tools": overview["build_tools"],
        "maven": overview["maven"],
        "package_json": overview["package_json"],
        "test_file_kinds": overview["test_files"],
        "test_files_count": len(test_files),
        "test_files": test_files[:300],
        "runnable": runnable,
        "appium": bool(detect_layout(repo)),
        "bruno_collections": bruno[:100],
        "properties_files": overview["properties_files"],
        "workflows": overview["workflows"],
        "key_files": key_files,
        "structure": [{"folder": name, "files": count} for name, count in top.most_common(30)],
        "git": {
            "branch": _git(repo, "rev-parse", "--abbrev-ref", "HEAD") or None,
            "remote": _git(repo, "remote", "get-url", "origin") or None,
            "changed_files": changed,
            "changed_count": len(status_lines),
            "last_commit": {"sha": last[0], "author": last[1], "date": last[2], "message": last[3]}
            if len(last) >= 4 else None,
        },
        "files": files[:MAX_LISTED_FILES],
    }


def _sample_tests(repo: Path, test_files: list[str], count: int = 2) -> list[str]:
    def mtime(rel: str) -> float:
        try:
            return (repo / rel).stat().st_mtime
        except OSError:
            return 0

    preferred = [f for f in test_files if not f.endswith((".bru", ".postman_collection.json"))] or test_files
    return sorted(preferred, key=mtime, reverse=True)[:count]


MAX_TREE_CHARS = 30000


def _tree_text(analysis: dict, limit: int = MAX_TREE_CHARS) -> str:
    """Every file for small projects; for big ones the folders (with file counts) plus the test files."""
    files = [f for f in analysis["files"] if not is_sensitive(f)]
    full = "\n".join(files)
    if len(full) <= limit:
        return full
    folders = Counter(f.rsplit("/", 1)[0] if "/" in f else "." for f in files)
    lines = [f"(Large project: {len(files)} files. Folders with their file count; ask for or attach specific files.)"]
    for folder, count in sorted(folders.items()):
        lines.append(f"{folder}/ ({count})")
        if sum(len(line) for line in lines) > limit * 2 // 3:
            lines.append(f"… and {len(folders) - len(lines) + 1} more folders")
            break
    examples = analysis["test_files"][:150]
    if examples:
        lines += ["", "Some test files:", *examples]
    text = "\n".join(lines)
    return text[:limit]


def build_system_prompt(repo: Path, analysis: dict, attached: list[str],
                        max_chars: int = MAX_CONTEXT_CHARS) -> tuple[str, list[str]]:
    """System prompt with the project context; returns (prompt, files included)."""
    lines = [
        "You are the AI test-automation assistant inside ATM (AutomationTestManager). You help the user implement "
        "new automated tests and features in their local project, following the project's existing frameworks, "
        "structure, naming and coding conventions.",
        "",
        "Rules:",
        "- Base your answers on the project context below. If you need a file that is not included, ask the user to "
        "attach it (they can attach any project file to their message).",
        "- When you create or change files, output the COMPLETE new content of every file in its own fenced block "
        "whose info string is `file:` followed by the path relative to the project root, for example:",
        "```file:tests/login.spec.js",
        "// full file content",
        "```",
        "  The user reviews each file and applies it with one click, so never put partial files or diffs in these "
        "blocks and only use them for files that should be written. Use ordinary code blocks for other snippets.",
        "- Keep changes focused; reuse existing helpers, page objects, fixtures, configuration and test data.",
        "- Never write real credentials or secrets; reference the existing configuration or environment variables. "
        "Values shown as *** were masked before being sent to you.",
        "- After the files, explain briefly what you changed and how to run it (the user runs tests from the Test tab "
        "of this page, which supports the project's detected frameworks).",
        "",
        "# Project",
        f"Local checkout: {Path(analysis['path']).name} ({analysis['files_count']} files)",
    ]
    git = analysis.get("git") or {}
    if git.get("branch"):
        lines.append(f"Git branch: {git['branch']}; uncommitted changes: {git.get('changed_count', 0)}")
    if analysis["languages"]:
        lines.append("Languages: " + ", ".join(f"{lang['name']} ({lang['files']} files)"
                                               for lang in analysis["languages"][:8]))
    if analysis["frameworks"] or analysis["build_tools"]:
        lines.append("Frameworks/libraries: " + ", ".join(analysis["frameworks"] + analysis["build_tools"]))
    if analysis.get("maven"):
        maven = analysis["maven"]
        lines.append(f"Maven: artifact {maven.get('artifact')}, Java {maven.get('java_release')}, "
                     f"stacks {', '.join(maven.get('stacks') or [])}")
    for runner in analysis["runnable"]:
        lines.append(f"Runnable: {runner['name']} in '{runner['root']}' via {runner['runner']} "
                     f"({runner['targets']} targets)")
    if analysis["bruno_collections"]:
        lines.append("Bruno collections: " + ", ".join(analysis["bruno_collections"][:20]))
    if analysis["test_file_kinds"]:
        lines.append("Test files: " + ", ".join(f"{k}: {v}" for k, v in analysis["test_file_kinds"].items()))

    budget = max_chars
    tree_text = _tree_text(analysis, max_chars // 5)
    lines += ["", "# File tree", tree_text]
    budget -= len(tree_text)

    included: list[str] = []
    sections: list[str] = []

    def add(rel: str, title: str, limit: int) -> None:
        nonlocal budget
        if rel in included or budget <= 2000:
            return
        try:
            content, truncated = read_project_file(repo, rel, min(limit, budget - 1000))
        except ProjectAIError:
            return
        note = " (truncated)" if truncated else ""
        sections.append(f"## {title}: {rel}{note}\n```\n{content}\n```")
        included.append(rel)
        budget -= len(content) + len(rel) + 40

    for rel in attached[:MAX_ATTACHED_FILES]:
        add(rel, "Attached by the user", MAX_FILE_CHARS)
    for rel in analysis["key_files"][:10]:
        add(rel, "Project configuration", 6000)
    for rel in _sample_tests(repo, analysis["test_files"]):
        add(rel, "Example of an existing test (follow its conventions)", 8000)
    if sections:
        lines += ["", "# File contents", *sections]
    return "\n".join(lines), included


# ── Proposed changes ─────────────────────────────────────────────────────────

_FENCE_OPEN = re.compile(r"^(?P<fence>`{3,}|~{3,})\s*file:\s*(?P<path>\S+?)\s*$")


def parse_changes(text: str) -> list[dict]:
    """Files proposed in ```file:<path> blocks; a later block for the same path wins."""
    changes: dict[str, dict] = {}
    lines = text.split("\n")
    index = 0
    while index < len(lines):
        match = _FENCE_OPEN.match(lines[index].strip())
        if not match:
            index += 1
            continue
        fence = match.group("fence")
        body: list[str] = []
        index += 1
        while index < len(lines) and not (lines[index].strip().startswith(fence[0] * len(fence))
                                          and lines[index].strip().strip(fence[0]) == ""):
            body.append(lines[index])
            index += 1
        index += 1
        path = match.group("path").strip("`'\"")
        content = "\n".join(body)
        if not content.endswith("\n"):
            content += "\n"
        changes[path] = {"path": path, "content": content}
    return list(changes.values())


def strip_file_blocks(text: str) -> str:
    """Shorten old assistant answers in the history: keep the prose, drop full file contents."""
    out: list[str] = []
    lines = text.split("\n")
    index = 0
    while index < len(lines):
        match = _FENCE_OPEN.match(lines[index].strip())
        if not match:
            out.append(lines[index])
            index += 1
            continue
        fence = match.group("fence")
        index += 1
        while index < len(lines) and not (lines[index].strip().startswith(fence[0] * len(fence))
                                          and lines[index].strip().strip(fence[0]) == ""):
            index += 1
        index += 1
        out.append(f"[proposed full content of {match.group('path')} omitted]")
    return "\n".join(out)


def _sha(data: bytes | None) -> str | None:
    return hashlib.sha256(data).hexdigest() if data is not None else None


def _matching_line_endings(content: str, current: bytes | None) -> str:
    if current is not None and b"\r\n" in current[:65536]:
        return content.replace("\r\n", "\n").replace("\n", "\r\n")
    return content


def preview_change(repo: Path, rel_path: str, content: str) -> dict:
    path, rel = resolve_project_path(repo, rel_path)
    current = path.read_bytes() if path.is_file() else None
    current_text = current.decode("utf-8", errors="replace").replace("\r\n", "\n") if current is not None else ""
    new_text = content.replace("\r\n", "\n")
    status = "create" if current is None else "unchanged" if current_text == new_text else "modify"
    diff_lines = list(difflib.unified_diff(current_text.splitlines(), new_text.splitlines(),
                                           f"a/{rel}" if current is not None else "/dev/null", f"b/{rel}",
                                           lineterm="", n=3))
    added = sum(1 for line in diff_lines if line.startswith("+") and not line.startswith("+++"))
    removed = sum(1 for line in diff_lines if line.startswith("-") and not line.startswith("---"))
    truncated = len(diff_lines) > 800
    return {"path": rel, "status": status, "added": added, "removed": removed,
            "diff": "\n".join(diff_lines[:800]), "diff_truncated": truncated, "current_sha": _sha(current)}


def apply_change(repo: Path, rel_path: str, content: str, expected_sha: str | None = None) -> dict:
    path, rel = resolve_project_path(repo, rel_path)
    if len(content.encode("utf-8")) > MAX_CHANGE_BYTES:
        raise ProjectAIError(f"'{rel}' is too large to write from the assistant.")
    if path.exists() and not path.is_file():
        raise ProjectAIError(f"'{rel}' is a folder.")
    current = path.read_bytes() if path.is_file() else None
    if expected_sha is not None and _sha(current) != expected_sha:
        raise ProjectAIError(f"'{rel}' changed on disk since the change was reviewed. Review it again.", 409)
    data = _matching_line_endings(content, current).encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return {"path": rel, "previous": current.decode("utf-8", errors="replace") if current is not None else None,
            "previous_existed": current is not None, "applied_sha": _sha(data)}


def undo_change(repo: Path, rel_path: str, previous: str | None, previous_existed: bool, applied_sha: str) -> dict:
    path, rel = resolve_project_path(repo, rel_path)
    current = path.read_bytes() if path.is_file() else None
    if _sha(current) != applied_sha:
        raise ProjectAIError(f"'{rel}' was edited after the change was applied, so it is not undone automatically.",
                             409)
    if previous_existed:
        path.write_bytes((previous or "").encode("utf-8"))
    elif path.is_file():
        path.unlink()
    return {"path": rel, "restored": previous_existed}


# ── Run failures ─────────────────────────────────────────────────────────────

def run_failure_summary(run: dict, max_log_lines: int = 150) -> str:
    """Compact, masked description of a test run for the AI (failed tests + end of the log)."""
    lines = [f"Test run '{run.get('name') or run.get('collection') or run.get('id')}' finished with status "
             f"{run.get('status')}: {run.get('passed', 0)} passed, {run.get('failed', 0)} failed, "
             f"{run.get('skipped', 0)} skipped."]
    command = (run.get("details") or {}).get("command")
    if command:
        lines.append("Command: " + " ".join(command))
    failures = [r for r in run.get("results") or [] if r.get("status") in ("failed", "error")]
    if failures:
        lines.append("Failed tests:")
        for result in failures[:25]:
            message = (result.get("error_message") or "").strip()
            lines.append(f"- {result.get('class_name') or ''} › {result.get('test_name')}: {message[:600]}")
            trace = (result.get("stack_trace") or "").strip()
            if trace:
                lines.append("  " + "\n  ".join(trace.splitlines()[:15]))
    log = [str(entry.get("data", "")) for entry in run.get("logs") or []
           if isinstance(entry, dict) and entry.get("type") in ("stdout", "stderr") and entry.get("data")]
    if log:
        lines += ["", f"Last {min(len(log), max_log_lines)} log lines:", "```", *log[-max_log_lines:], "```"]
    return mask_secrets("\n".join(lines))


# ── Conversations ────────────────────────────────────────────────────────────

class ConversationStore:
    def __init__(self, root: Path, user_id: int, project_id: int):
        self.dir = root / "ai-chats" / str(int(user_id)) / str(int(project_id))

    def _path(self, conversation_id: str) -> Path:
        if not re.fullmatch(r"[a-f0-9]{32}", conversation_id or ""):
            raise ProjectAIError("Conversation not found.", 404)
        return self.dir / f"{conversation_id}.json"

    def list(self) -> list[dict]:
        if not self.dir.is_dir():
            return []
        items = []
        for path in self.dir.glob("*.json"):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            items.append({"id": data["id"], "title": data.get("title") or "New conversation",
                          "created_at": data.get("created_at"), "updated_at": data.get("updated_at"),
                          "messages": len(data.get("messages") or [])})
        return sorted(items, key=lambda c: c.get("updated_at") or "", reverse=True)

    def create(self, title: str | None = None) -> dict:
        now = _now()
        data = {"id": uuid.uuid4().hex, "title": (title or "").strip()[:80] or "New conversation",
                "created_at": now, "updated_at": now, "messages": []}
        self.save(data)
        return data

    def load(self, conversation_id: str) -> dict:
        path = self._path(conversation_id)
        if not path.is_file():
            raise ProjectAIError("Conversation not found.", 404)
        return json.loads(path.read_text(encoding="utf-8"))

    def save(self, data: dict) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        data["updated_at"] = _now()
        path = self._path(data["id"])
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
        tmp.replace(path)

    def delete(self, conversation_id: str) -> None:
        path = self._path(conversation_id)
        if path.is_file():
            path.unlink()


def new_message(role: str, content: str, **extra) -> dict:
    return {"id": uuid.uuid4().hex, "role": role, "content": content, "created_at": _now(), **extra}


def history_for_model(messages: list[dict]) -> list[dict]:
    """The conversation as sent to the model: recent messages, older file contents shortened."""
    chat = [m for m in messages if m.get("role") in ("user", "assistant") and m.get("content")]
    recent = chat[-MAX_HISTORY_MESSAGES:]
    out = []
    for index, message in enumerate(recent):
        content = message.get("model_content") or message["content"]
        if message["role"] == "assistant" and index < len(recent) - 2:
            content = strip_file_blocks(content)
        out.append({"role": message["role"], "content": content})
    # Providers require the conversation to start with a user message.
    while out and out[0]["role"] != "user":
        out.pop(0)
    return out
