"""Find and edit Bruno environment files (``environments/*.bru``) of a collection in the linked checkout.

Only the ``vars { ... }`` block is edited, line by line, so ordering, comments and other
blocks are preserved. Disabled variables (``~name: value``) can be toggled. Variables listed
in ``vars:secret [ ... ]`` have no value in the file (the Bruno app keeps it), so they are
shown read-only. Values of credential-like names are masked unless explicitly revealed.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

from app.services.properties_service import PropertiesError, _git_status, is_secret_key

MAX_FILE_BYTES = 512 * 1024
MAX_VALUE_LENGTH = 4096
_NAME_RE = re.compile(r"^[A-Za-z0-9_.\-]{1,200}$")
_BLOCK_START_RE = re.compile(r"^\s*([A-Za-z:\-]+)\s*([{\[])\s*$")
_VAR_RE = re.compile(r"^(\s*)(~?)([^:\s][^:]*?)\s*:\s?(.*)$")


@dataclass
class BruVar:
    name: str
    value: str
    enabled: bool
    line: int  # 0-based
    indent: str
    multiline: bool = False
    secret_list: bool = False


@dataclass
class ParsedEnv:
    variables: list[BruVar]
    vars_block: tuple[int, int] | None  # (start line, closing line) of "vars {"


def parse(text: str) -> ParsedEnv:
    lines = text.split("\n")
    variables: list[BruVar] = []
    vars_block = None
    i = 0
    while i < len(lines):
        match = _BLOCK_START_RE.match(lines[i].rstrip("\r"))
        if not match:
            i += 1
            continue
        name, opener = match.group(1), match.group(2)
        closer = "}" if opener == "{" else "]"
        start = i
        i += 1
        while i < len(lines) and lines[i].strip() != closer:
            raw = lines[i].rstrip("\r")
            if name == "vars" and opener == "{":
                var = _VAR_RE.match(raw)
                if var:
                    value = var.group(4)
                    entry = BruVar(var.group(3).strip(), value, not var.group(2), i, var.group(1))
                    if value.strip().startswith("'''"):
                        # Multi-line value: keep it as-is and read-only.
                        entry.multiline = True
                        j = i + 1
                        while j < len(lines) and "'''" not in lines[j]:
                            j += 1
                        entry.value = "\n".join(line.rstrip("\r") for line in lines[i:j + 1])
                        i = j
                    variables.append(entry)
            elif name == "vars:secret" and opener == "[":
                for item in raw.split(","):
                    item = item.strip()
                    if item:
                        enabled = not item.startswith("~")
                        variables.append(BruVar(item.lstrip("~"), "", enabled, i, "", secret_list=True))
            i += 1
        if name == "vars" and opener == "{" and vars_block is None:
            vars_block = (start, i)
        i += 1
    return ParsedEnv(variables, vars_block)


# ── Files ────────────────────────────────────────────────────────────────────

def _within(repo: Path, path: Path) -> bool:
    try:
        path.resolve().relative_to(repo.resolve())
        return True
    except ValueError:
        return False


def _collection_dir(repo: Path, collection: str) -> Path:
    collection = (collection or "").strip().strip("/")
    if not collection or ".." in Path(collection).parts:
        raise PropertiesError("Invalid collection path.")
    path = repo / collection
    if not _within(repo, path) or not path.is_dir():
        raise PropertiesError("Collection not found in the linked checkout.", 404)
    return path


def _environment_dirs(repo: Path, collection_dir: Path) -> list[Path]:
    # Same lookup order the runner uses: <collection>/environments, then ../environments.
    dirs = [collection_dir / "environments"]
    if collection_dir.resolve() != repo.resolve():
        dirs.append(collection_dir.parent / "environments")
    return [d for d in dirs if d.is_dir() and _within(repo, d)]


def discover_env_files(repo: Path, collection: str) -> list[Path]:
    collection_dir = _collection_dir(repo, collection)
    files: list[Path] = []
    for env_dir in _environment_dirs(repo, collection_dir):
        for path in sorted(env_dir.glob("*.bru"), key=lambda p: p.name.lower()):
            if path.is_file() and not path.is_symlink() and path.stat().st_size <= MAX_FILE_BYTES:
                files.append(path)
    return files


def resolve_env_file(repo: Path, rel_path: str) -> Path:
    if not rel_path or rel_path.startswith(("/", "\\")) or ".." in Path(rel_path).parts:
        raise PropertiesError("Invalid environment file path.")
    path = repo / rel_path
    if (path.suffix != ".bru" or path.parent.name != "environments" or not _within(repo, path)
            or path.is_symlink() or not path.is_file()):
        raise PropertiesError("Environment file not found in the linked checkout.", 404)
    if path.stat().st_size > MAX_FILE_BYTES:
        raise PropertiesError("Environment file is too large to edit here.")
    return path


def _read(path: Path) -> tuple[str, str]:
    data = path.read_bytes()
    return data.decode("utf-8", errors="replace"), hashlib.sha256(data).hexdigest()


def list_files(repo: Path, collection: str) -> list[dict]:
    collection_dir = _collection_dir(repo, collection)
    files = []
    for path in discover_env_files(repo, collection):
        text, _ = _read(path)
        files.append({
            "path": path.relative_to(repo).as_posix(),
            "environment": path.stem,
            "shared": path.parent.parent.resolve() != collection_dir.resolve(),
            "entries": len(parse(text).variables),
            "git_status": _git_status(repo, path),
        })
    return files


def _entry_id(var: BruVar) -> str:
    return f"{'secret:' if var.secret_list else ''}{var.name}"


def read_file(repo: Path, rel_path: str, reveal: bool = False) -> dict:
    path = resolve_env_file(repo, rel_path)
    text, etag = _read(path)
    entries = []
    for var in parse(text).variables:
        masked = is_secret_key(var.name) and not var.secret_list
        note = None
        if var.secret_list:
            note = "Secret variable: its value is stored by the Bruno app, not in this file."
        elif var.multiline:
            note = "Multi-line value: edit it in Bruno or a text editor."
        entries.append({
            "id": _entry_id(var),
            "key": var.name,
            "value": None if var.secret_list or (masked and not reveal) else var.value,
            "secret": masked or var.secret_list,
            "has_value": bool(var.value),
            "line": var.line + 1,
            "multiline": var.multiline,
            "enabled": var.enabled,
            "readonly": var.secret_list or var.multiline,
            "note": note,
        })
    return {
        "path": path.relative_to(repo).as_posix(),
        "etag": etag,
        "git_status": _git_status(repo, path),
        "revealed": reveal,
        "entries": entries,
    }


def _validate_value(name: str, value) -> str:
    if not isinstance(value, str):
        raise PropertiesError(f"Value for '{name}' must be text.")
    if "\n" in value or "\r" in value:
        raise PropertiesError(f"Value for '{name}' must be a single line.")
    if len(value) > MAX_VALUE_LENGTH:
        raise PropertiesError(f"Value for '{name}' is too long.")
    return value


def update_file(repo: Path, rel_path: str, etag: str, changes: dict, additions: dict,
                enabled: dict | None = None) -> dict:
    """``changes``/``enabled`` are keyed by variable name; ``additions`` maps new names to values."""
    path = resolve_env_file(repo, rel_path)
    text, current_etag = _read(path)
    if etag != current_etag:
        raise PropertiesError("The file was changed on disk since it was loaded. Reload it and try again.", 409)

    lines = text.split("\n")
    parsed = parse(text)
    by_name: dict[str, BruVar] = {}
    for var in parsed.variables:
        if not var.secret_list:
            by_name[var.name] = var  # Bruno uses the last occurrence

    changes, enabled = changes or {}, enabled or {}
    for name in set(changes) | set(enabled):
        found = by_name.get(name)
        if not found:
            raise PropertiesError(f"Variable '{name}' does not exist in {rel_path}.")
        var = found
        if var.multiline:
            raise PropertiesError(f"Variable '{name}' has a multi-line value and can't be edited here.")
        value = _validate_value(name, changes[name]) if name in changes else var.value
        is_enabled = bool(enabled[name]) if name in enabled else var.enabled
        line_ending = "\r" if lines[var.line].endswith("\r") else ""
        lines[var.line] = f"{var.indent}{'' if is_enabled else '~'}{var.name}: {value}{line_ending}"

    new_names = list((additions or {}).keys())
    for name in new_names:
        if not _NAME_RE.match(name or ""):
            raise PropertiesError(f"Invalid variable name '{name}'. Use letters, digits, '.', '_' or '-'.")
        if name in by_name or any(v.name == name for v in parsed.variables):
            raise PropertiesError(f"Variable '{name}' already exists in {rel_path}.")
    if new_names:
        uses_crlf = bool(lines) and lines[0].endswith("\r")
        eol = "\r" if uses_crlf else ""
        indent = next((v.indent for v in parsed.variables if not v.secret_list and v.indent), "  ")
        new_lines = [f"{indent}{name}: {_validate_value(name, additions[name])}{eol}" for name in new_names]
        if parsed.vars_block:
            closing = parsed.vars_block[1]
            lines[closing:closing] = new_lines
        else:
            block = [f"vars {{{eol}", *new_lines, f"}}{eol}"]
            if lines and lines[0].strip():
                block.append(eol)
            lines[0:0] = block

    path.write_bytes("\n".join(lines).encode("utf-8"))
    return read_file(repo, rel_path)


def revert_file(repo: Path, rel_path: str) -> dict:
    import subprocess

    path = resolve_env_file(repo, rel_path)
    if _git_status(repo, path) != "modified":
        raise PropertiesError("Only files with local changes to a committed version can be reverted.")
    rel = path.relative_to(repo).as_posix()
    result = subprocess.run(["git", "checkout", "--", rel], cwd=repo, capture_output=True, text=True,
                            timeout=30, check=False)
    if result.returncode != 0:
        raise PropertiesError(f"git checkout failed: {(result.stderr or result.stdout).strip()[:200]}", 500)
    return read_file(repo, rel_path)
