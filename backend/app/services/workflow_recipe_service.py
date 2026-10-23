"""Derive an ordered, allow-listed dependency-install plan for a project's
local working copy — the way GitHub Actions would set the job up before running
a collection.

The plan is built from two sources:

1. The project's *run* workflow — the first ``.github/workflows/*.yml`` file
   whose name contains ``run`` (e.g. ``run-tests.yml``). Its ``run:`` shell
   steps are scanned for install commands, preserving order.
2. The project's framework — the one the user selected **and** the one
   auto-detected from the imported repository — so the framework's runner CLI
   (e.g. the Bruno CLI) is always available for local runs.

Security: workflow ``run:`` lines are never executed verbatim. Every candidate
sub-command is tokenised and matched against a small allow-list of recognised
install commands; anything unrecognised (or an unexpected/dangerous token) is
skipped. Only server-reconstructed argv vectors are ever executed.
"""
from __future__ import annotations

import asyncio
import os
import re
import shlex
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import yaml

from app.services.framework_detector import FrameworkDetector, TestFramework
from app.services.local_repo_service import LocalRepoService


class WorkflowRecipeError(Exception):
    """Raised when building/running the setup plan fails."""


# Directories we never descend into when scanning the working copy.
_SKIP_DIRS = {
    ".git", "node_modules", ".venv", "venv", "env", "dist", "build", ".next",
    "out", "coverage", "__pycache__", ".pytest_cache", ".mypy_cache", ".idea",
    ".vscode", "target", "vendor", ".gradle", ".tox",
}
_MAX_DEPTH = 6
_MAX_FILES = 8000
_MAX_STEPS = 40
_MAX_OUTPUT = 100_000

# Allow-list validators for the tokens we pass through to reconstructed argv.
_PKG_NAME_RE = re.compile(r"^@?[A-Za-z0-9][A-Za-z0-9._/-]*$")        # npm/gem package
_PKG_SPEC_RE = re.compile(                                            # pip requirement spec
    r"^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9,._-]+\])?"
    r"([<>=!~]=?[0-9A-Za-z._*-]+)*$"
)
_FILE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")              # requirements file / path
_BROWSER_RE = re.compile(r"^[a-z][a-z-]*$")                          # playwright browser name

# Framework -> runner-level tools that a manifest install would NOT cover.
# Keyed by framework name; each value is an ordered list of argv vectors.
_FRAMEWORK_DEFAULTS: dict[str, list[list[str]]] = {
    "bruno": [["npm", "install", "-g", "@usebruno/cli"]],
    "playwright": [["npx", "playwright", "install"]],
    "cypress": [["npx", "cypress", "install"]],
    "pytest": [["pip", "install", "pytest"]],
    "robot": [["pip", "install", "robotframework"]],
}


class WorkflowRecipeService:
    """Build & execute an ordered dependency-install plan for a local project."""

    # ── discovery ────────────────────────────────────────────────────────────

    @staticmethod
    def _load_run_workflow(root: Path) -> tuple[Path | None, dict | None]:
        """Find and parse the first ``.github/workflows/*run*.yml`` file."""
        wf_dir = root / ".github" / "workflows"
        if not wf_dir.is_dir():
            return None, None
        candidates = sorted(
            p for p in wf_dir.iterdir()
            if p.is_file()
            and p.suffix.lower() in (".yml", ".yaml")
            and "run" in p.name.lower()
        )
        for path in candidates:
            try:
                data = yaml.safe_load(path.read_text(encoding="utf-8", errors="replace"))
            except (OSError, yaml.YAMLError):
                continue
            if isinstance(data, dict):
                return path, data
        return (candidates[0] if candidates else None), None

    @staticmethod
    def _list_files(root: Path) -> list[str]:
        """Return repo-relative POSIX paths for framework auto-detection."""
        files: list[str] = []
        root = root.resolve()
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS]
            rel_dir = Path(dirpath).resolve().relative_to(root)
            if len(rel_dir.parts) > _MAX_DEPTH:
                dirnames[:] = []
                continue
            for fname in filenames:
                rel = (rel_dir / fname).as_posix() if str(rel_dir) != "." else fname
                files.append(rel)
                if len(files) >= _MAX_FILES:
                    return files
        return files

    # ── framework resolution ─────────────────────────────────────────────────

    @staticmethod
    def _resolve_frameworks(project, file_paths: list[str]) -> list[str]:
        """Combine the user's chosen framework with the auto-detected one."""
        valid = {f.value for f in TestFramework} - {TestFramework.UNKNOWN.value}
        frameworks: list[str] = []
        selected = (getattr(project, "framework", "") or "").strip().lower()
        if selected in valid:
            frameworks.append(selected)
        for fw in FrameworkDetector.detect_frameworks(file_paths):
            if fw not in frameworks:
                frameworks.append(fw)
        return frameworks

    # ── workflow parsing ─────────────────────────────────────────────────────

    @classmethod
    def _iter_run_commands(cls, workflow: dict) -> Iterator[tuple[str, str]]:
        """Yield (sub_command, working_directory) for each ``run:`` shell step."""
        jobs = workflow.get("jobs")
        if not isinstance(jobs, dict):
            return
        for job in jobs.values():
            if not isinstance(job, dict):
                continue
            steps = job.get("steps")
            if not isinstance(steps, list):
                continue
            for step in steps:
                if not isinstance(step, dict):
                    continue
                run = step.get("run")
                if not isinstance(run, str):
                    continue
                step_wd = step.get("working-directory")
                current_wd = step_wd if isinstance(step_wd, str) else ""
                for raw_line in run.splitlines():
                    line = raw_line.strip()
                    if not line or line.startswith("#"):
                        continue
                    for sub in re.split(r"&&|;", line):
                        sub = sub.strip().rstrip("\\").strip()
                        if not sub:
                            continue
                        try:
                            toks = shlex.split(sub)
                        except ValueError:
                            continue
                        if not toks:
                            continue
                        # `cd <dir>` sets the working directory for what follows.
                        if toks[0] == "cd" and len(toks) >= 2:
                            current_wd = cls._join_wd(step_wd or "", toks[1])
                            continue
                        yield sub, current_wd

    @staticmethod
    def _join_wd(base: str, extra: str) -> str:
        parts = [p for p in (base, extra) if p]
        return "/".join(parts).replace("\\", "/")

    @classmethod
    def _match_install_command(cls, toks: list[str]) -> list[str] | None:
        """Map a tokenised sub-command to an allow-listed argv, or None."""
        if not toks:
            return None

        head = toks[0]

        # npm / pnpm / yarn -------------------------------------------------
        if head in ("npm", "pnpm"):
            if len(toks) >= 2 and toks[1] in ("install", "i", "ci", "add"):
                sub = "ci" if toks[1] == "ci" else "install"
                rest = toks[2:]
                is_global = any(f in ("-g", "--global") for f in rest)
                raw_pkgs = [t for t in rest if not t.startswith("-")]
                if is_global:
                    # e.g. `npm install -g "@usebruno/cli@${BRUNO_CLI_VERSION}"` —
                    # salvage the package name, dropping any ${VAR} version.
                    pkgs = [p for p in (cls._clean_npm_pkg(t) for t in raw_pkgs) if p]
                    return [head, "install", "-g", *pkgs] if pkgs else None
                if toks[1] == "add" or raw_pkgs:
                    return None  # local add of specific pkgs -> manifests handle it
                return [head, sub]  # bare install (guarded by package.json presence)
            return None
        if head == "yarn":
            if len(toks) == 1 or (len(toks) >= 2 and toks[1] == "install"):
                return ["yarn", "install"]
            return None

        # pip / python -m pip ----------------------------------------------
        pip_argv = cls._match_pip(toks)
        if pip_argv is not None:
            return pip_argv

        # playwright browser binaries --------------------------------------
        if head == "npx" and len(toks) >= 3 and toks[1] == "playwright" and toks[2] == "install":
            extra = [t for t in toks[3:] if t == "--with-deps" or _BROWSER_RE.match(t)]
            return ["npx", "playwright", "install", *extra]
        if head == "playwright" and len(toks) >= 2 and toks[1] == "install":
            extra = [t for t in toks[2:] if t == "--with-deps" or _BROWSER_RE.match(t)]
            return ["playwright", "install", *extra]
        if head == "npx" and len(toks) >= 3 and toks[1] == "cypress" and toks[2] == "install":
            return ["npx", "cypress", "install"]

        # other ecosystems --------------------------------------------------
        if head == "poetry" and len(toks) >= 2 and toks[1] == "install":
            return ["poetry", "install"]
        if head == "pipenv" and len(toks) >= 2 and toks[1] == "install":
            return ["pipenv", "install"]
        if head == "bundle" and len(toks) >= 2 and toks[1] == "install":
            return ["bundle", "install"]
        if head == "gem" and len(toks) >= 3 and toks[1] == "install":
            pkgs = [t for t in toks[2:] if cls._is_pkg_name(t)]
            return ["gem", "install", *pkgs] if pkgs else None
        if head == "go" and toks[1:3] == ["mod", "download"]:
            return ["go", "mod", "download"]

        return None

    @classmethod
    def _match_pip(cls, toks: list[str]) -> list[str] | None:
        """Recognise pip install commands (pip / pip3 / python -m pip)."""
        rest: list[str] | None = None
        if toks[0] in ("pip", "pip3") and len(toks) >= 2 and toks[1] == "install":
            rest = toks[2:]
        elif (
            toks[0] in ("python", "python3")
            and toks[1:3] == ["-m", "pip"]
            and len(toks) >= 4
            and toks[3] == "install"
        ):
            rest = toks[4:]
        if rest is None:
            return None

        argv = ["pip", "install"]
        i = 0
        matched = False
        while i < len(rest):
            tok = rest[i]
            if tok in ("-r", "--requirement") and i + 1 < len(rest) and _FILE_RE.match(rest[i + 1]):
                argv += ["-r", rest[i + 1]]
                i += 2
                matched = True
                continue
            if tok in ("-e", "--editable") and i + 1 < len(rest):
                target = rest[i + 1]
                if target == "." or _FILE_RE.match(target):
                    argv += ["-e", target]
                    i += 2
                    matched = True
                    continue
                return None
            if tok in ("-U", "--upgrade"):
                i += 1
                continue
            if tok.startswith("-"):
                return None  # unknown flag -> skip whole command for safety
            if _PKG_SPEC_RE.match(tok):
                argv.append(tok)
                matched = True
                i += 1
                continue
            return None
        return argv if matched else None

    @staticmethod
    def _is_pkg_name(tok: str) -> bool:
        return bool(_PKG_NAME_RE.match(tok))

    @staticmethod
    def _clean_npm_pkg(tok: str) -> str | None:
        """Return the bare npm package name, dropping a trailing ``@<version>``
        (which may contain shell variables like ``${BRUNO_CLI_VERSION}``)."""
        name = tok
        if tok.startswith("@"):
            at = tok.find("@", 1)  # scoped: @scope/name@version
            if at != -1:
                name = tok[:at]
        else:
            at = tok.find("@")
            if at != -1:
                name = tok[:at]
        return name if _PKG_NAME_RE.match(name) else None

    @staticmethod
    def _needs_package_json(argv: list[str]) -> bool:
        """True for bare local node installs that require a package.json."""
        if "-g" in argv:
            return False
        return argv[:2] in (["npm", "install"], ["npm", "ci"],
                            ["pnpm", "install"], ["yarn", "install"])

    # ── plan assembly ────────────────────────────────────────────────────────

    @classmethod
    def _safe_rel_dir(cls, root: Path, rel: str) -> str | None:
        """Validate ``rel`` stays inside ``root``; return its POSIX form or None."""
        if not rel:
            return ""
        candidate = (root / rel).resolve()
        if candidate != root and root not in candidate.parents:
            return None
        try:
            out = candidate.relative_to(root).as_posix()
        except ValueError:
            return None
        return "" if out == "." else out

    @classmethod
    def _compute_steps(
        cls, project, root: Path
    ) -> tuple[str, list[str], list[dict[str, Any]]]:
        """Return (run_workflow_rel, frameworks, raw_steps) — steps carry argv."""
        workflow_path, workflow = cls._load_run_workflow(root)
        file_paths = cls._list_files(root)
        frameworks = cls._resolve_frameworks(project, file_paths)

        raw_steps: list[dict[str, Any]] = []
        seen: set = set()

        if workflow:
            for cmd_str, wd in cls._iter_run_commands(workflow):
                if len(raw_steps) >= _MAX_STEPS:
                    break
                try:
                    toks = shlex.split(cmd_str)
                except ValueError:
                    continue
                argv = cls._match_install_command(toks)
                if not argv:
                    continue
                rel_dir = cls._safe_rel_dir(root, wd)
                if rel_dir is None:
                    continue
                # A bare `npm/yarn/pnpm install` needs a package.json at its cwd;
                # skip it when there isn't one instead of failing with ENOENT.
                if cls._needs_package_json(argv):
                    pkg_dir = (root / rel_dir) if rel_dir else root
                    if not (pkg_dir / "package.json").is_file():
                        continue
                key = (tuple(argv), rel_dir)
                if key in seen:
                    continue
                seen.add(key)
                raw_steps.append(
                    {"argv": argv, "cwd": rel_dir, "kind": "workflow", "source": "run workflow"}
                )

        for fw in frameworks:
            for argv in _FRAMEWORK_DEFAULTS.get(fw, []):
                if len(raw_steps) >= _MAX_STEPS:
                    break
                key = (tuple(argv), "")
                if key in seen:
                    continue
                seen.add(key)
                raw_steps.append(
                    {"argv": argv, "cwd": "", "kind": "framework", "source": f"framework: {fw}"}
                )

        workflow_rel = str(workflow_path.relative_to(root)) if workflow_path else ""
        return workflow_rel, frameworks, raw_steps

    @staticmethod
    def _describe(raw_steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for i, s in enumerate(raw_steps):
            out.append(
                {
                    "id": f"step-{i + 1}",
                    "label": " ".join(s["argv"]),
                    "command": " ".join(s["argv"]),
                    "cwd": s["cwd"],
                    "kind": s["kind"],
                    "source": s["source"],
                }
            )
        return out

    # ── public API ───────────────────────────────────────────────────────────

    @classmethod
    def build_plan(cls, project) -> dict[str, Any]:
        """Return the ordered install plan (no commands executed)."""
        root = LocalRepoService.get_local_path(project)
        if not root.exists():
            raise WorkflowRecipeError("Local working copy not found. Sync the project first.")
        workflow_rel, frameworks, raw_steps = cls._compute_steps(project, root)
        return {
            "run_workflow": workflow_rel,
            "frameworks": frameworks,
            "steps": cls._describe(raw_steps),
        }

    @classmethod
    async def install(cls, project, timeout: int = 900) -> dict[str, Any]:
        """Execute the ordered install plan, stopping at the first failure."""
        root = LocalRepoService.get_local_path(project)
        if not root.exists():
            raise WorkflowRecipeError("Local working copy not found. Sync the project first.")

        workflow_rel, frameworks, raw_steps = cls._compute_steps(project, root)
        per_step_timeout = max(30, min(int(timeout or 900), 1800))

        results: list[dict[str, Any]] = []
        overall = 0
        failed = False
        for i, step in enumerate(raw_steps):
            if failed:
                results.append(cls._skipped_result(i, step, "Skipped after a previous failure"))
                continue
            result = await cls._run_step(root, i, step, per_step_timeout)
            results.append(result)
            if result["exit_code"] != 0:
                overall = result["exit_code"]
                failed = True

        return {
            "run_workflow": workflow_rel,
            "frameworks": frameworks,
            "exit_code": overall,
            "steps": results,
        }

    # ── execution ────────────────────────────────────────────────────────────

    @staticmethod
    def _skipped_result(index: int, step: dict[str, Any], note: str) -> dict[str, Any]:
        return {
            "id": f"step-{index + 1}",
            "label": " ".join(step["argv"]),
            "command": " ".join(step["argv"]),
            "cwd": step["cwd"],
            "kind": step["kind"],
            "source": step["source"],
            "exit_code": 0,
            "timed_out": False,
            "skipped": True,
            "duration_seconds": 0.0,
            "stdout": "",
            "stderr": note,
        }

    @classmethod
    async def _run_step(
        cls, root: Path, index: int, step: dict[str, Any], timeout: int
    ) -> dict[str, Any]:
        argv: list[str] = step["argv"]
        work_dir = (root / step["cwd"]).resolve() if step["cwd"] else root
        base = {
            "id": f"step-{index + 1}",
            "label": " ".join(argv),
            "command": " ".join(argv),
            "cwd": step["cwd"],
            "kind": step["kind"],
            "source": step["source"],
            "skipped": False,
        }

        if not work_dir.is_dir():
            return {**base, "exit_code": 1, "timed_out": False, "duration_seconds": 0.0,
                    "stdout": "", "stderr": f"Working directory not found: {step['cwd']}"}

        env = dict(os.environ)
        env["GIT_TERMINAL_PROMPT"] = "0"
        env["CI"] = "1"

        started = time.monotonic()
        try:
            proc = await asyncio.create_subprocess_exec(
                *argv,
                cwd=str(work_dir),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
        except FileNotFoundError:
            return {**base, "exit_code": 127, "timed_out": False,
                    "duration_seconds": round(time.monotonic() - started, 2),
                    "stdout": "", "stderr": f"Command not found: {argv[0]}"}

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

        return {
            **base,
            "exit_code": exit_code,
            "timed_out": timed_out,
            "duration_seconds": round(time.monotonic() - started, 2),
            "stdout": cls._cap(stdout_b),
            "stderr": cls._cap(stderr_b),
        }

    @staticmethod
    def _cap(b: bytes) -> str:
        text = b.decode(errors="replace")
        if len(text) > _MAX_OUTPUT:
            return text[:_MAX_OUTPUT] + "\n… output truncated …"
        return text
