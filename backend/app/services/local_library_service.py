"""Detect the dependency manifests inside a project's local working copy
(``requirements.txt``, ``package.json``, ``pyproject.toml`` …), list the
libraries they declare, and run the appropriate install command.

Only a fixed set of server-derived install commands can be executed (never an
arbitrary user string), keeping the surface a small, inspectable set of argv
vectors.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from pathlib import Path
from typing import Any

try:
    import tomllib
except ModuleNotFoundError:
    import tomli as tomllib

from app.services.local_repo_service import LocalRepoService


class LocalLibraryError(Exception):
    """Raised when library detection / installation fails."""


# Directories we never descend into when scanning for manifests.
_SKIP_DIRS = {
    ".git", "node_modules", ".venv", "venv", "env", "dist", "build", ".next",
    "out", "coverage", "__pycache__", ".pytest_cache", ".mypy_cache", ".idea",
    ".vscode", "target", "vendor", ".gradle", ".tox",
}
_MAX_DEPTH = 4
_MAX_MANIFESTS = 50
_MAX_OUTPUT = 100_000
_REQUIREMENT_RE = re.compile(r"^\s*([A-Za-z0-9._-]+)\s*([<>=!~]=?.*)?$")


class LocalLibraryService:
    """Dependency-manifest detection + install for a local working copy."""

    @staticmethod
    def _iter_manifest_files(root: Path):
        """Yield (relative_dir, path) for known manifest files up to a depth."""
        root = root.resolve()
        for dirpath, dirnames, filenames in os.walk(root):
            # prune skip dirs in place
            dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS]
            rel = Path(dirpath).resolve().relative_to(root)
            if len(rel.parts) > _MAX_DEPTH:
                dirnames[:] = []
                continue
            for fname in filenames:
                if fname in (
                    "requirements.txt", "package.json", "pyproject.toml",
                    "Pipfile", "Gemfile", "go.mod",
                ) or fname.startswith("requirements") and fname.endswith(".txt"):
                    yield rel, Path(dirpath) / fname

    # ── parsers ──────────────────────────────────────────────────────────────

    @staticmethod
    def _parse_requirements(text: str) -> list[dict[str, str]]:
        deps: list[dict[str, str]] = []
        for line in text.splitlines():
            line = line.split("#", 1)[0].strip()
            if not line or line.startswith("-"):
                continue
            m = _REQUIREMENT_RE.match(line)
            if m:
                deps.append({"name": m.group(1), "version": (m.group(2) or "").strip()})
        return deps

    @staticmethod
    def _parse_package_json(text: str) -> list[dict[str, str]]:
        deps: list[dict[str, str]] = []
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            return deps
        for section in ("dependencies", "devDependencies"):
            block = data.get(section)
            if isinstance(block, dict):
                for name, version in block.items():
                    deps.append({"name": str(name), "version": str(version or "")})
        return deps

    @staticmethod
    def _parse_pyproject(text: str) -> list[dict[str, str]]:
        deps: list[dict[str, str]] = []
        try:
            data = tomllib.loads(text)
        except (tomllib.TOMLDecodeError, ValueError):
            return deps
        # PEP 621
        project = data.get("project")
        if isinstance(project, dict):
            for entry in project.get("dependencies") or []:
                if isinstance(entry, str):
                    m = _REQUIREMENT_RE.match(entry.strip())
                    if m:
                        deps.append({"name": m.group(1), "version": (m.group(2) or "").strip()})
        # Poetry
        tool = data.get("tool")
        if isinstance(tool, dict) and isinstance(tool.get("poetry"), dict):
            poetry_deps = tool["poetry"].get("dependencies")
            if isinstance(poetry_deps, dict):
                for name, spec in poetry_deps.items():
                    if str(name).lower() == "python":
                        continue
                    version = spec if isinstance(spec, str) else ""
                    deps.append({"name": str(name), "version": str(version)})
        return deps

    @classmethod
    def _install_command(cls, manifest_name: str, pkg_dir: Path) -> list[str]:
        """Return the argv used to install this manifest's dependencies."""
        if manifest_name == "package.json":
            if (pkg_dir / "pnpm-lock.yaml").exists():
                return ["pnpm", "install"]
            if (pkg_dir / "yarn.lock").exists():
                return ["yarn", "install"]
            return ["npm", "install"]
        if manifest_name.startswith("requirements") and manifest_name.endswith(".txt"):
            return ["pip", "install", "-r", manifest_name]
        if manifest_name == "pyproject.toml":
            return ["pip", "install", "-e", "."]
        if manifest_name == "Pipfile":
            return ["pipenv", "install"]
        if manifest_name == "Gemfile":
            return ["bundle", "install"]
        if manifest_name == "go.mod":
            return ["go", "mod", "download"]
        return []

    @classmethod
    def _ecosystem(cls, manifest_name: str) -> str:
        if manifest_name == "package.json":
            return "node"
        if manifest_name.startswith("requirements") or manifest_name in ("pyproject.toml", "Pipfile"):
            return "python"
        if manifest_name == "Gemfile":
            return "ruby"
        if manifest_name == "go.mod":
            return "go"
        return "unknown"

    # ── public API ───────────────────────────────────────────────────────────

    @classmethod
    def detect(cls, project) -> list[dict[str, Any]]:
        """Return a list of manifests with their declared libraries."""
        root = LocalRepoService.get_local_path(project)
        if not root.exists():
            raise LocalLibraryError("Local working copy not found. Sync the project first.")

        manifests: list[dict[str, Any]] = []
        for rel_dir, path in cls._iter_manifest_files(root):
            if len(manifests) >= _MAX_MANIFESTS:
                break
            name = path.name
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue

            if name == "package.json":
                deps = cls._parse_package_json(text)
            elif name == "pyproject.toml":
                deps = cls._parse_pyproject(text)
            elif name.startswith("requirements") and name.endswith(".txt"):
                deps = cls._parse_requirements(text)
            else:
                deps = []

            rel_path = str(rel_dir / name) if str(rel_dir) != "." else name
            manifests.append(
                {
                    "id": rel_path,
                    "manifest": name,
                    "path": rel_path,
                    "ecosystem": cls._ecosystem(name),
                    "install_command": " ".join(cls._install_command(name, path.parent)),
                    "libraries": deps,
                    "count": len(deps),
                }
            )
        manifests.sort(key=lambda m: m["path"])
        return manifests

    @classmethod
    async def install(cls, project, manifest_id: str, timeout: int = 600) -> dict[str, Any]:
        """Run the install command for a detected manifest and capture output."""
        root = LocalRepoService.get_local_path(project)
        if not root.exists():
            raise LocalLibraryError("Local working copy not found. Sync the project first.")

        target = (root / manifest_id).resolve()
        if target != root and root not in target.parents:
            raise LocalLibraryError("Invalid manifest path.")
        if not target.is_file():
            raise LocalLibraryError("Manifest not found. Rescan and try again.")

        pkg_dir = target.parent
        argv = cls._install_command(target.name, pkg_dir)
        if not argv:
            raise LocalLibraryError("No install command available for this manifest.")

        timeout = max(10, min(int(timeout or 600), 1800))
        env = dict(os.environ)
        env["GIT_TERMINAL_PROMPT"] = "0"
        env["CI"] = "1"

        started = time.monotonic()
        try:
            proc = await asyncio.create_subprocess_exec(
                *argv,
                cwd=str(pkg_dir),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
        except FileNotFoundError as exc:
            raise LocalLibraryError(f"Command not found: {argv[0]}") from exc

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
            "manifest_id": manifest_id,
            "command": " ".join(argv),
            "cwd": str(pkg_dir.relative_to(root)) if pkg_dir != root else "",
            "exit_code": exit_code,
            "timed_out": timed_out,
            "duration_seconds": duration,
            "stdout": _cap(stdout_b),
            "stderr": _cap(stderr_b),
        }
