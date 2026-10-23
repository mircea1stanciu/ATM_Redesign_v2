"""Find and edit Java ``.properties`` files in a linked local checkout.

Edits are applied line by line, so comments, ordering and untouched entries are
preserved exactly. Files are read and written as ISO-8859-1 (what
``java.util.Properties.load(InputStream)`` uses); non-Latin-1 characters in new
values are written as ``\\uXXXX`` escapes. Values of credential-like keys are
masked unless explicitly revealed.
"""
from __future__ import annotations

import hashlib
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

MAX_FILES = 200
MAX_FILE_BYTES = 512 * 1024
MAX_VALUE_LENGTH = 4096
_SKIP_DIRS = {".git", "target", "build", "node_modules", ".gradle", ".idea", ".automationtestmanager", "out"}
_SECRET_KEY_RE = re.compile(
    r"pass(word)?|pwd|secret|token|api[_-]?key|private[_-]?key|credential|(^|[^a-z])pin([^a-z]|$)", re.I
)
_KEY_RE = re.compile(r"^[A-Za-z0-9_.\-]{1,200}$")


class PropertiesError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass
class Entry:
    key: str
    value: str
    start: int  # first physical line index
    end: int  # last physical line index (continuations)
    key_raw: str
    separator: str
    indent: str


def is_secret_key(key: str) -> bool:
    return bool(_SECRET_KEY_RE.search(key))


# ── Parsing / escaping ───────────────────────────────────────────────────────

def _unescape(text: str) -> str:
    out = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == "\\" and i + 1 < len(text):
            nxt = text[i + 1]
            if nxt == "u" and re.match(r"[0-9a-fA-F]{4}", text[i + 2:i + 6]):
                out.append(chr(int(text[i + 2:i + 6], 16)))
                i += 6
                continue
            out.append({"t": "\t", "n": "\n", "r": "\r", "f": "\f"}.get(nxt, nxt))
            i += 2
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def escape_value(value: str) -> str:
    out = []
    for index, ch in enumerate(value):
        if ch == "\\":
            out.append("\\\\")
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\r":
            out.append("\\r")
        elif ch == "\t":
            out.append("\\t")
        elif ch == " " and index == 0:
            out.append("\\ ")
        elif ord(ch) > 0xFF:
            out.append(f"\\u{ord(ch):04x}")
        else:
            out.append(ch)
    return "".join(out)


def _ends_with_continuation(line: str) -> bool:
    trailing = len(line) - len(line.rstrip("\\"))
    return trailing % 2 == 1


def parse_entries(text: str) -> list[Entry]:
    lines = text.split("\n")
    entries: list[Entry] = []
    i = 0
    while i < len(lines):
        line = lines[i].rstrip("\r")
        stripped = line.lstrip()
        if not stripped or stripped[0] in "#!":
            i += 1
            continue
        start = i
        logical = stripped
        while _ends_with_continuation(logical) and i + 1 < len(lines):
            i += 1
            logical = logical[:-1] + lines[i].rstrip("\r").lstrip()
        indent = line[: len(line) - len(stripped)]
        match = re.match(r"((?:\\.|[^\s=:\\])*)(\s*[=:]\s*|\s+)?(.*)$", logical, re.S)
        key_raw, separator, value_raw = match.group(1), match.group(2) or "", match.group(3)
        entries.append(Entry(_unescape(key_raw), _unescape(value_raw), start, i, key_raw, separator or " = ", indent))
        i += 1
    return entries


# ── Files ────────────────────────────────────────────────────────────────────

def _within(repo: Path, path: Path) -> bool:
    try:
        path.resolve().relative_to(repo.resolve())
        return True
    except ValueError:
        return False


def discover_properties_files(repo: Path) -> list[Path]:
    found: list[Path] = []

    def walk(directory: Path) -> None:
        try:
            children = sorted(directory.iterdir(), key=lambda p: p.name.lower())
        except OSError:
            return
        for child in children:
            if len(found) >= MAX_FILES:
                return
            if child.is_symlink():
                continue
            if child.is_dir():
                if child.name not in _SKIP_DIRS:
                    walk(child)
            elif child.suffix == ".properties" and child.stat().st_size <= MAX_FILE_BYTES:
                found.append(child)

    walk(repo)
    return found


def resolve_properties_file(repo: Path, rel_path: str) -> Path:
    if not rel_path or rel_path.startswith(("/", "\\")) or ".." in Path(rel_path).parts:
        raise PropertiesError("Invalid properties file path.")
    path = repo / rel_path
    if path.suffix != ".properties" or not _within(repo, path):
        raise PropertiesError("Invalid properties file path.")
    if path.resolve() not in {p.resolve() for p in discover_properties_files(repo)}:
        raise PropertiesError("Properties file not found in the linked checkout.", 404)
    return path


def _git_status(repo: Path, path: Path) -> str:
    """'clean', 'modified', 'untracked' or 'unknown'."""
    rel = path.relative_to(repo).as_posix()
    try:
        result = subprocess.run(["git", "status", "--porcelain", "--", rel], cwd=repo,
                                capture_output=True, text=True, timeout=15, check=False)
    except (OSError, subprocess.SubprocessError):
        return "unknown"
    if result.returncode != 0:
        return "unknown"
    out = result.stdout.strip()
    if not out:
        return "clean"
    return "untracked" if out.startswith("??") else "modified"


def _read(path: Path) -> tuple[str, str]:
    data = path.read_bytes()
    return data.decode("latin-1"), hashlib.sha256(data).hexdigest()


def list_files(repo: Path) -> list[dict]:
    files = []
    for path in discover_properties_files(repo):
        text, _ = _read(path)
        files.append({
            "path": path.relative_to(repo).as_posix(),
            "entries": len(parse_entries(text)),
            "git_status": _git_status(repo, path),
        })
    return files


def read_file(repo: Path, rel_path: str, reveal: bool = False) -> dict:
    path = resolve_properties_file(repo, rel_path)
    text, etag = _read(path)
    entries = []
    for entry in parse_entries(text):
        secret = is_secret_key(entry.key)
        entries.append({
            "key": entry.key,
            "value": entry.value if (reveal or not secret) else None,
            "secret": secret,
            "has_value": bool(entry.value),
            "line": entry.start + 1,
            "multiline": entry.end > entry.start,
        })
    return {
        "path": path.relative_to(repo).as_posix(),
        "etag": etag,
        "git_status": _git_status(repo, path),
        "revealed": reveal,
        "entries": entries,
    }


def _validate_value(key: str, value) -> str:
    if not isinstance(value, str):
        raise PropertiesError(f"Value for '{key}' must be text.")
    if len(value) > MAX_VALUE_LENGTH:
        raise PropertiesError(f"Value for '{key}' is too long.")
    return value


def update_file(repo: Path, rel_path: str, etag: str, changes: dict, additions: dict) -> dict:
    path = resolve_properties_file(repo, rel_path)
    text, current_etag = _read(path)
    if etag != current_etag:
        raise PropertiesError("The file was changed on disk since it was loaded. Reload it and try again.", 409)

    lines = text.split("\n")
    entries = parse_entries(text)
    by_key: dict[str, Entry] = {}
    for entry in entries:
        by_key[entry.key] = entry  # Java uses the last occurrence

    replacements: dict[int, tuple[int, str]] = {}
    for key, value in (changes or {}).items():
        entry = by_key.get(key)
        if not entry:
            raise PropertiesError(f"Property '{key}' does not exist in {rel_path}.")
        line_ending = "\r" if lines[entry.end].endswith("\r") else ""
        new_line = f"{entry.indent}{entry.key_raw}{entry.separator}{escape_value(_validate_value(key, value))}"
        replacements[entry.start] = (entry.end, new_line + line_ending)

    for start in sorted(replacements, reverse=True):
        end, new_line = replacements[start]
        lines[start:end + 1] = [new_line]

    new_lines = []
    for key, value in (additions or {}).items():
        if not _KEY_RE.match(key or ""):
            raise PropertiesError(f"Invalid property name '{key}'. Use letters, digits, '.', '_' or '-'.")
        if key in by_key:
            raise PropertiesError(f"Property '{key}' already exists in {rel_path}.")
        new_lines.append(f"{key} = {escape_value(_validate_value(key, value))}")
    if new_lines:
        uses_crlf = bool(lines) and lines[0].endswith("\r")
        if lines and lines[-1] == "":
            lines.pop()
        lines.extend(line + ("\r" if uses_crlf else "") for line in new_lines)
        lines.append("")

    path.write_bytes("\n".join(lines).encode("latin-1"))
    return read_file(repo, rel_path)


def revert_file(repo: Path, rel_path: str) -> dict:
    path = resolve_properties_file(repo, rel_path)
    status = _git_status(repo, path)
    if status != "modified":
        raise PropertiesError("Only files with local changes to a committed version can be reverted.")
    rel = path.relative_to(repo).as_posix()
    result = subprocess.run(["git", "checkout", "--", rel], cwd=repo, capture_output=True, text=True,
                            timeout=30, check=False)
    if result.returncode != 0:
        raise PropertiesError(f"git checkout failed: {(result.stderr or result.stdout).strip()[:200]}", 500)
    return read_file(repo, rel_path)
