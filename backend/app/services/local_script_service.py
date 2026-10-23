"""Detect and run scripts inside a project's local working copy, and read/write
its files. Runs only server-detected commands (never an arbitrary user string)
so the surface stays a fixed, inspectable set of argv vectors.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import shlex
import time
from pathlib import Path

from app.services.local_repo_service import LocalRepoService


class LocalScriptError(Exception):
    """Raised when script detection / execution / file IO fails."""


# Directories we never descend into when scanning for scripts.
_SKIP_DIRS = {
    ".git", "node_modules", ".venv", "venv", "env", "dist", "build", ".next",
    "out", "coverage", "__pycache__", ".pytest_cache", ".mypy_cache", ".idea",
    ".vscode", "target", "vendor", ".gradle", ".tox", "bin", "obj",
}

_MAKE_TARGET_RE = re.compile(r"^([A-Za-z0-9][A-Za-z0-9_.\-/]*)\s*:")

# Per-type caps so a large repo can't produce a giant list.
_MAX_PER_TYPE = 300
# Output captured per stream.
_MAX_OUTPUT = 100_000
# Largest file we will read/write through the editor.
_MAX_FILE_BYTES = 2_000_000
# Only scan the top of a file for a "Usage:" header comment.
_USAGE_SCAN_BYTES = 4_000

_USAGE_HEADER_RE = re.compile(r"usage\s*:", re.IGNORECASE)
_EXAMPLE_HEADER_RE = re.compile(r"examples?(?:\s+usage)?\s*:", re.IGNORECASE)
_COMMENT_PREFIX_RE = re.compile(r"^\s*(?:/\*\*|/\*|\*/|\*|#|//)+\s?")
_USAGE_TOKEN_RE = re.compile(r"\[([^\[\]]+)\]|<([^<>]+)>")


class LocalScriptService:
    """Script detection + execution + file editing for a local working copy."""

    # ── path safety ──────────────────────────────────────────────────────────

    @staticmethod
    def _safe_target(root: Path, rel_path: str, must_be_file: bool = False) -> Path:
        target = (root / rel_path).resolve() if rel_path else root
        if target != root and root not in target.parents:
            raise LocalScriptError("Invalid path.")
        if must_be_file and target.exists() and not target.is_file():
            raise LocalScriptError("Path is not a file.")
        return target

    # ── package-manager detection ────────────────────────────────────────────

    @staticmethod
    def _pm_prefix(pkg_dir: Path) -> tuple[list[str], str]:
        """Return the run-prefix argv + human name for a package.json dir."""
        if (pkg_dir / "pnpm-lock.yaml").exists():
            return ["pnpm", "run"], "pnpm"
        if (pkg_dir / "yarn.lock").exists():
            return ["yarn"], "yarn"
        return ["npm", "run"], "npm"

    # ── usage / variable detection ───────────────────────────────────────────

    @classmethod
    def _extract_header_block(cls, text: str, header_re: re.Pattern) -> str | None:
        """Pull a header (e.g. "Usage:"/"Example:") comment block out of source text."""
        lines = text.splitlines()
        for i, line in enumerate(lines):
            if not header_re.search(line):
                continue
            block = [line]
            for follow in lines[i + 1 : i + 40]:
                stripped = follow.strip()
                if not stripped or stripped in ("*/", "*", "#", "//"):
                    break
                block.append(follow)
            cleaned = [_COMMENT_PREFIX_RE.sub("", ln).rstrip() for ln in block]
            text_block = "\n".join(ln for ln in cleaned if ln.strip() or ln == "").strip("\n")
            return text_block or None
        return None

    @classmethod
    def _extract_usage(cls, text: str) -> str | None:
        """Pull a "Usage:" header comment block out of a script's source text."""
        return cls._extract_header_block(text, _USAGE_HEADER_RE)

    @classmethod
    def _extract_example(cls, text: str) -> str | None:
        """Pull an "Example:"/"Examples:" header comment block out of source text."""
        return cls._extract_header_block(text, _EXAMPLE_HEADER_RE)

    @classmethod
    def _parse_usage_params(cls, usage_text: str | None) -> list[dict]:
        """Extract positional args / flags out of a parsed "Usage:" block.

        ``[foo]`` / ``<foo>`` → optional/required positional arg named ``foo``.
        ``[--flag]`` → boolean flag. ``[--flag=value]`` / ``[--flag value]`` →
        a flag that takes a string value. Angle brackets mark a token required.
        """
        if not usage_text:
            return []
        params: list[dict] = []
        seen: set[str] = set()
        for m in _USAGE_TOKEN_RE.finditer(usage_text):
            token = (m.group(1) if m.group(1) is not None else m.group(2) or "").strip()
            required = m.group(2) is not None
            if not token:
                continue
            if token.startswith("--"):
                body = token[2:]
                if "=" in body:
                    name, value_type = body.split("=", 1)[0], "string"
                elif " " in body:
                    name, value_type = body.split(" ", 1)[0], "string"
                else:
                    name, value_type = body, "boolean"
                param_type = "flag"
            else:
                name, value_type, param_type = token, "string", "positional"
            key = f"{param_type}:{name}"
            if key in seen:
                continue
            seen.add(key)
            params.append({
                "name": name,
                "type": param_type,
                "value_type": value_type,
                "required": required,
            })
        return params

    @classmethod
    def _read_usage_and_params(cls, file_path: Path) -> tuple[str | None, list[dict], str | None]:
        try:
            with file_path.open("r", encoding="utf-8", errors="replace") as f:
                head = f.read(_USAGE_SCAN_BYTES)
        except OSError:
            return None, [], None
        usage = cls._extract_usage(head)
        example = cls._extract_example(head)
        return usage, cls._parse_usage_params(usage), example

    @classmethod
    def build_run_argv(cls, params: list[dict], values: dict) -> list[str]:
        """Turn saved config ``values`` (keyed by param name) into extra argv."""
        argv: list[str] = []
        for p in params:
            name = p["name"]
            val = values.get(name)
            if p["type"] == "positional":
                if val not in (None, ""):
                    argv.append(str(val))
            elif p.get("value_type") == "boolean":
                if val:
                    argv.append(f"--{name}")
            else:
                if val not in (None, ""):
                    argv.append(f"--{name}")
                    argv.append(str(val))
        return argv

    # ── detection ────────────────────────────────────────────────────────────

    @classmethod
    def detect(cls, project) -> list[dict]:
        """Scan the working copy and return runnable scripts.

        Each dict has public fields (id/type/name/description/command/cwd/source)
        plus internal ``_argv`` / ``_cwd`` used by :meth:`run`.
        """
        root = LocalRepoService.get_local_path(project)
        if not (root / ".git").exists():
            raise LocalScriptError("No local checkout exists yet. Sync the repository first.")

        primary: list[dict] = []   # package.json / make / pytest
        shell: list[dict] = []
        code: list[dict] = []      # py / js / ts

        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS]
            rel_dir = os.path.relpath(dirpath, root)
            rel_dir = "" if rel_dir == "." else rel_dir.replace(os.sep, "/")
            here = Path(dirpath)

            for fn in filenames:
                rel_file = f"{rel_dir}/{fn}" if rel_dir else fn

                if fn == "package.json":
                    cls._detect_package_json(here, rel_dir, rel_file, primary)
                elif fn in ("Makefile", "makefile", "GNUmakefile"):
                    cls._detect_makefile(here / fn, rel_dir, rel_file, primary)
                elif fn in ("pytest.ini", "conftest.py"):
                    cls._detect_pytest(rel_dir, rel_file, primary)
                elif fn.endswith(".sh"):
                    if len(shell) < _MAX_PER_TYPE:
                        usage, params, example = cls._read_usage_and_params(here / fn)
                        shell.append({
                            "id": f"shell:{rel_file}",
                            "type": "shell",
                            "name": fn,
                            "description": f"Run shell script {rel_file}",
                            "command": f"bash {fn}",
                            "cwd": rel_dir,
                            "source": rel_file,
                            "usage": usage,
                            "params": params,
                            "example": example,
                            "_argv": ["bash", fn],
                            "_cwd": rel_dir,
                        })
                elif fn.endswith(".py") and fn != "conftest.py":
                    if len(code) < _MAX_PER_TYPE:
                        usage, params, example = cls._read_usage_and_params(here / fn)
                        code.append({
                            "id": f"python:{rel_file}",
                            "type": "python",
                            "name": fn,
                            "description": f"Run Python file {rel_file}",
                            "command": f"python3 {fn}",
                            "cwd": rel_dir,
                            "source": rel_file,
                            "usage": usage,
                            "params": params,
                            "example": example,
                            "_argv": ["python3", fn],
                            "_cwd": rel_dir,
                        })
                elif fn.endswith((".js", ".cjs", ".mjs")):
                    if len(code) < _MAX_PER_TYPE:
                        usage, params, example = cls._read_usage_and_params(here / fn)
                        code.append({
                            "id": f"node:{rel_file}",
                            "type": "node",
                            "name": fn,
                            "description": f"Run JS file with Node {rel_file}",
                            "command": f"node {fn}",
                            "cwd": rel_dir,
                            "source": rel_file,
                            "usage": usage,
                            "params": params,
                            "example": example,
                            "_argv": ["node", fn],
                            "_cwd": rel_dir,
                        })
                elif fn.endswith(".ts") and not fn.endswith(".d.ts"):
                    if len(code) < _MAX_PER_TYPE:
                        usage, params, example = cls._read_usage_and_params(here / fn)
                        code.append({
                            "id": f"typescript:{rel_file}",
                            "type": "typescript",
                            "name": fn,
                            "description": f"Run TS file with npx tsx {rel_file}",
                            "command": f"npx tsx {fn}",
                            "cwd": rel_dir,
                            "source": rel_file,
                            "usage": usage,
                            "params": params,
                            "example": example,
                            "_argv": ["npx", "--yes", "tsx", fn],
                            "_cwd": rel_dir,
                        })

        return primary + shell + code

    @classmethod
    def _detect_package_json(cls, pkg_dir: Path, rel_dir: str, rel_file: str, out: list[dict]) -> None:
        try:
            data = json.loads((pkg_dir / "package.json").read_text("utf-8"))
        except (OSError, ValueError):
            return
        scripts = data.get("scripts")
        if not isinstance(scripts, dict):
            return
        prefix, pm = cls._pm_prefix(pkg_dir)
        label = rel_dir or "(root)"
        for name, body in scripts.items():
            if not isinstance(name, str):
                continue
            out.append({
                "id": f"npm:{rel_dir}:{name}",
                "type": "npm",
                "name": name,
                "description": f"{pm} script in {label}: {str(body)[:120]}",
                "command": f"{' '.join(prefix)} {name}",
                "cwd": rel_dir,
                "source": rel_file,
                "_argv": [*prefix, name],
                "_cwd": rel_dir,
            })

    @classmethod
    def _detect_makefile(cls, makefile: Path, rel_dir: str, rel_file: str, out: list[dict]) -> None:
        try:
            text = makefile.read_text("utf-8", errors="replace")
        except OSError:
            return
        seen: set[str] = set()
        for line in text.splitlines():
            if line.startswith("\t") or "=" in line.split(":", 1)[0]:
                continue
            m = _MAKE_TARGET_RE.match(line)
            if not m:
                continue
            target = m.group(1)
            if target in seen or target.startswith(".") or "/" in target:
                continue
            seen.add(target)
            out.append({
                "id": f"make:{rel_dir}:{target}",
                "type": "make",
                "name": target,
                "description": f"make target in {rel_dir or '(root)'}",
                "command": f"make {target}",
                "cwd": rel_dir,
                "source": rel_file,
                "_argv": ["make", target],
                "_cwd": rel_dir,
            })

    @classmethod
    def _detect_pytest(cls, rel_dir: str, rel_file: str, out: list[dict]) -> None:
        marker = f"pytest:{rel_dir}"
        if any(s["id"] == marker for s in out):
            return
        out.append({
            "id": marker,
            "type": "pytest",
            "name": "pytest",
            "description": f"Run pytest in {rel_dir or '(root)'}",
            "command": "python3 -m pytest",
            "cwd": rel_dir,
            "source": rel_file,
            "_argv": ["python3", "-m", "pytest"],
            "_cwd": rel_dir,
        })

    # ── execution ────────────────────────────────────────────────────────────

    @classmethod
    async def run(cls, project, script_id: str, timeout: int = 300, config_values: dict | None = None) -> dict:
        """Execute a previously-detected script by id and capture its output.

        ``config_values`` (saved via the script's "Edit" configuration) are
        turned into extra CLI arguments based on the script's detected
        "Usage:" params (see :meth:`build_run_argv`).
        """
        scripts = cls.detect(project)
        by_id = {s["id"]: s for s in scripts}
        script = by_id.get(script_id)
        if not script:
            raise LocalScriptError("Script not found. Rescan and try again.")

        root = LocalRepoService.get_local_path(project)
        cwd = cls._safe_target(root, script["_cwd"])
        if not cwd.is_dir():
            raise LocalScriptError("Script working directory no longer exists.")

        extra_argv = cls.build_run_argv(script.get("params", []), config_values or {})
        argv = [*script["_argv"], *extra_argv]

        timeout = max(5, min(int(timeout or 300), 1800))
        env = dict(os.environ)
        env["GIT_TERMINAL_PROMPT"] = "0"
        env["CI"] = "1"

        started = time.monotonic()
        try:
            proc = await asyncio.create_subprocess_exec(
                *argv,
                cwd=str(cwd),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
        except FileNotFoundError as exc:
            raise LocalScriptError(f"Command not found: {argv[0]}") from exc

        timed_out = False
        try:
            stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            exit_code = proc.returncode or 0
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            stdout_b, stderr_b = b"", b""
            exit_code = -1
            timed_out = True

        duration = round(time.monotonic() - started, 2)

        def _cap(b: bytes) -> str:
            text = b.decode(errors="replace")
            if len(text) > _MAX_OUTPUT:
                return text[:_MAX_OUTPUT] + "\n… output truncated …"
            return text

        return {
            "script_id": script_id,
            "command": shlex.join(argv) if extra_argv else script["command"],
            "cwd": script["_cwd"],
            "exit_code": exit_code,
            "timed_out": timed_out,
            "duration_seconds": duration,
            "stdout": _cap(stdout_b),
            "stderr": _cap(stderr_b),
        }

    # ── file editing ─────────────────────────────────────────────────────────

    @classmethod
    def read_file(cls, project, rel_path: str) -> dict:
        root = LocalRepoService.get_local_path(project)
        if not (root / ".git").exists():
            raise LocalScriptError("No local checkout exists yet. Sync the repository first.")
        if not rel_path:
            raise LocalScriptError("A file path is required.")
        target = cls._safe_target(root, rel_path, must_be_file=True)
        if not target.exists():
            raise LocalScriptError("File not found.")
        size = target.stat().st_size
        if size > _MAX_FILE_BYTES:
            return {"path": rel_path, "content": None, "size": size, "binary": True, "too_large": True}
        try:
            content = target.read_text("utf-8")
        except UnicodeDecodeError:
            return {"path": rel_path, "content": None, "size": size, "binary": True, "too_large": False}
        return {"path": rel_path, "content": content, "size": size, "binary": False, "too_large": False}

    @classmethod
    def write_file(cls, project, rel_path: str, content: str) -> dict:
        root = LocalRepoService.get_local_path(project)
        if not (root / ".git").exists():
            raise LocalScriptError("No local checkout exists yet. Sync the repository first.")
        if not rel_path:
            raise LocalScriptError("A file path is required.")
        if len(content.encode("utf-8")) > _MAX_FILE_BYTES:
            raise LocalScriptError("File is too large to save through the editor.")
        target = cls._safe_target(root, rel_path, must_be_file=True)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return cls.read_file(project, rel_path)
