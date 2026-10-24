"""Test run execution: background runs (Bruno, Appium, other frameworks), live logs and the run registry."""
import asyncio
import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import HTTPException, WebSocket
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.core.permissions import ensure
from app.modules.projects.models import AnalyticsRun, AnalyticsSuite, TestEnvironment
from app.modules.reporting import allure

manual_run_sockets: dict[str, set[WebSocket]] = {}


# Running Appium (Maven) processes, so they can be cancelled.
manual_run_processes: dict[str, int] = {}


cancelled_manual_runs: set[str] = set()


# Strong references so fire-and-forget run tasks are not garbage-collected.
_run_tasks: set[asyncio.Task] = set()


def _spawn_run_task(coro) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _run_tasks.add(task)
    task.add_done_callback(_run_tasks.discard)
    return task


RUN_NAME_MAX_LENGTH = 120


def _clean_run_name(name: Optional[str]) -> Optional[str]:
    cleaned = " ".join((name or "").split())
    if len(cleaned) > RUN_NAME_MAX_LENGTH:
        raise HTTPException(status_code=400, detail=f"Run name must be at most {RUN_NAME_MAX_LENGTH} characters.")
    return cleaned or None


class AnalyticsRunExecuteRequest(BaseModel):
    run_project: Optional[str] = None
    run_collection: Optional[str] = None
    run_environment: Optional[str] = None
    # Appium (Maven) runs: run_type="appium", appium_target="runner:<Class>" or
    # "suite:<folder>/<file.xml>".
    run_type: Optional[str] = None
    appium_target: Optional[str] = None
    app_env: Optional[str] = None
    device_run_option: Optional[str] = None
    # Any other framework: run_type="framework", framework_target=<id from /local/frameworks>.
    framework_target: Optional[str] = None
    extra_args: Optional[str] = None
    # A project environment (Tests › Environments): its variables are handed to the runner.
    environment_id: Optional[int] = None
    # Bruno: run only these requests/folders (relative to the collection), e.g. the changed ones.
    run_requests: Optional[list[str]] = None


def _run_app_version_label(details: Optional[dict]) -> Optional[str]:
    app = (details or {}).get("app") or {}
    if not app.get("version") and not app.get("build"):
        return None
    build = f" ({app['build']})" if app.get("build") and app.get("build") != app.get("version") else ""
    return f"{app.get('name') or 'App'} {app.get('version') or ''}{build}".strip()


def _analytics_run_response(run: AnalyticsRun) -> dict:
    metadata = next(
        (item for item in (run.logs_json or []) if isinstance(item, dict) and item.get("type") == "github_actions"),
        {},
    )
    return {
        "id": f"manual-{run.id}",
        "name": run.name,
        "app_version": _run_app_version_label(run.details_json),
        "report_count": len((run.details_json or {}).get("reports") or []),
        "suite_id": str(run.suite_id),
        "status": run.status,
        "branch": run.branch,
        "commit_sha": run.commit_sha,
        "triggered_by": run.triggered_by,
        "source": "github_actions" if metadata else "local",
        "trigger": run.trigger or "manual",
        "environment_id": str(run.environment_id) if run.environment_id else None,
        "collection": run.collection,
        "environment": run.environment,
        "execution_time": run.started_at.isoformat()
        if run.started_at
        else run.created_at.isoformat()
        if run.created_at
        else None,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
        "total_tests": run.total_tests,
        "passed_tests": run.passed_tests,
        "failed_tests": run.failed_tests,
        "skipped_tests": run.skipped_tests,
        "created_at": run.created_at.isoformat() if run.created_at else datetime.utcnow().isoformat(),
    }


async def _broadcast_manual_run_message(run_id: str, payload: dict) -> None:
    sockets = manual_run_sockets.get(run_id, set()).copy()
    for socket in sockets:
        try:
            await socket.send_json(payload)
        except Exception:
            manual_run_sockets.get(run_id, set()).discard(socket)


def _append_manual_run_log(manual_run_id: int, payload: dict) -> None:
    _append_manual_run_logs(manual_run_id, [payload])


def _append_manual_run_logs(manual_run_id: int, payloads: list[dict]) -> None:
    """Persist log entries in one write (only the last 1000 are kept)."""
    if not payloads:
        return
    db = SessionLocal()
    try:
        run = db.query(AnalyticsRun).filter(AnalyticsRun.id == manual_run_id).first()
        if not run:
            return
        logs = list(run.logs_json or [])
        now = datetime.utcnow().isoformat()
        logs.extend({**payload, "timestamp": payload.get("timestamp") or now} for payload in payloads)
        run.logs_json = logs[-1000:]
        db.commit()
    finally:
        db.close()


def _save_manual_run_status(manual_run_id: int, status: str) -> None:
    db = SessionLocal()
    try:
        run = db.query(AnalyticsRun).filter(AnalyticsRun.id == manual_run_id).first()
        if run:
            run.status = status
            if status not in ("running", "pending"):
                run.finished_at = datetime.utcnow()
            db.commit()
    finally:
        db.close()


async def _set_manual_run_status(run_id: str, manual_run_id: int, artifact_dir: Path, status: str) -> None:
    # Database writes run in a thread: waiting for SQLite's write lock must not block the event loop.
    await asyncio.to_thread(_save_manual_run_status, manual_run_id, status)
    payload = {"type": "status", "status": status, "timestamp": datetime.utcnow().isoformat()}
    await asyncio.to_thread(_append_manual_run_log, manual_run_id, payload)
    _append_manual_run_artifact_log(artifact_dir, payload)
    metadata_path = artifact_dir / "metadata.json"
    if metadata_path.is_file():
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        metadata["status"] = status
        metadata["finished_at"] = datetime.utcnow().isoformat() if status not in ("pending", "running") else None
        _write_manual_run_metadata(artifact_dir, metadata)
    await _broadcast_manual_run_message(run_id, payload)
    if status not in ("pending", "running"):
        from app.modules.deployments.service import on_run_finished

        await on_run_finished(manual_run_id, status)


ARTIFACTS_FOLDER = ".automationtestmanager"


def _manual_run_artifact_dir(repo_path: Path, run_id: str) -> Path:
    _exclude_from_git(repo_path, f"{ARTIFACTS_FOLDER}/")
    return repo_path / ARTIFACTS_FOLDER / "runs" / run_id


def _exclude_from_git(repo_path: Path, pattern: str) -> None:
    """Keep ATM's run artifacts out of commits: list them in the checkout's own .git/info/exclude (never in a
    tracked file), so 'Commit & push' does not pick them up even when the repository has no .gitignore for them."""
    git_dir = repo_path / ".git"
    if not git_dir.is_dir():
        return
    exclude = git_dir / "info" / "exclude"
    try:
        lines = exclude.read_text(encoding="utf-8").splitlines() if exclude.exists() else []
        if pattern not in lines:
            exclude.parent.mkdir(parents=True, exist_ok=True)
            exclude.write_text("\n".join([*lines, pattern]) + "\n", encoding="utf-8")
    except OSError:
        pass  # A read-only checkout still runs; the files just show as untracked.


def _write_manual_run_metadata(artifact_dir: Path, metadata: dict) -> None:
    artifact_dir.mkdir(parents=True, exist_ok=True)
    (artifact_dir / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")


def _append_manual_run_artifact_log(artifact_dir: Path, payload: dict) -> None:
    artifact_dir.mkdir(parents=True, exist_ok=True)
    timestamp = payload.get("timestamp") or datetime.utcnow().isoformat()
    message = payload.get("data") or f"$ status: {payload.get('status') or ''}".rstrip()
    with (artifact_dir / "live.log").open("a", encoding="utf-8") as log_file:
        log_file.write(f"[{timestamp}] {message}\n")


def _bruno_run_details(argv: list, collection: str, environment: str, started: datetime, exit_code,
                       artifact_dir: Path, report_files) -> dict:
    from app.services.appium_project_service import store_reports

    reports = [Path(p) for p in report_files if Path(p).is_file()]
    try:
        stored = store_reports(artifact_dir, reports, artifact_dir / "reports") if reports else []
    except OSError:
        stored = []
    return {
        "type": "bruno",
        "command": list(argv),
        "target": {"kind": "collection", "name": collection},
        "app_env": environment,
        "duration_seconds": round((datetime.utcnow() - started).total_seconds(), 1),
        "exit_code": exit_code,
        "technology": {"test_runner": "Bruno CLI"},
        "reports": stored,
        "artifact_dir": str(artifact_dir),
    }


async def _execute_manual_run_background(
    run_id: str,
    manual_run_id: int,
    repo_path: Path,
    run_collection: str,
    run_environment: str,
    run_requests: Optional[list[str]] = None,
) -> None:
    """Run a Bruno collection in the linked checkout and stream output via WebSocket."""
    artifact_dir = _manual_run_artifact_dir(repo_path, run_id)

    async def log(text: str, level: str = "stdout") -> None:
        payload = {"type": level, "data": text, "timestamp": datetime.utcnow().isoformat()}
        await asyncio.to_thread(_append_manual_run_log, manual_run_id, payload)
        _append_manual_run_artifact_log(artifact_dir, payload)
        await _broadcast_manual_run_message(run_id, payload)

    async def set_status(status: str) -> None:
        await _set_manual_run_status(run_id, manual_run_id, artifact_dir, status)

    try:
        collection_dir = (repo_path / run_collection.strip("/")).resolve()
        if repo_path not in [collection_dir, *collection_dir.parents]:
            await log(f"$ Error: '{run_collection}' is outside the checkout.", "stderr")
            await set_status("failed")
            return
        if not collection_dir.is_dir():
            await log(f"$ Error: collection directory '{run_collection}' not found.", "stderr")
            await set_status("failed")
            return

        env_file = collection_dir / "environments" / f"{run_environment}.bru"
        if not env_file.is_file():
            # Try one level up (collection lives at project/collection, envs at project/environments)
            env_file = collection_dir.parent / "environments" / f"{run_environment}.bru"
        env_path = (
            str(env_file.relative_to(collection_dir)) if env_file.is_file() else f"environments/{run_environment}.bru"
        )

        bru_bin = shutil.which("bru")
        paths = [p for p in (run_requests or []) if p and p != "."]
        if bru_bin:
            argv = [bru_bin, "run", *paths, "-r", "--sandbox", "developer", "--env-file", env_path]
        else:
            await log("$ `bru` not in PATH – trying npx @usebruno/cli ...")
            argv = ["npx", "--yes", "@usebruno/cli", "run", *paths, "-r", "--sandbox", "developer",
                    "--env-file", env_path]
        if paths:
            await log(f"$ Running only {len(paths)} changed request(s)/folder(s) of the collection.")

        junit_path = artifact_dir / "results.xml"
        json_path = artifact_dir / "results.json"
        argv.extend(["--reporter-junit", str(junit_path), "--reporter-json", str(json_path)])

        bruno_started = datetime.utcnow()
        await log(f"$ Working dir: {collection_dir}")
        await log(f"$ Command:     {' '.join(argv)}")
        await log("─" * 60)

        run_env = {**os.environ, "FORCE_COLOR": "0", "NO_COLOR": "1"}
        from app.services.appium_project_service import process_group_kwargs

        proc = await asyncio.create_subprocess_exec(
            *argv,
            cwd=str(collection_dir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=run_env,
            **process_group_kwargs(),
        )
        manual_run_processes[run_id] = proc.pid

        output_lines: dict[str, list[str]] = {"stdout": [], "stderr": []}

        async def stream(pipe, level: str) -> None:
            while True:
                line = await pipe.readline()
                if not line:
                    break
                text_line = line.decode("utf-8", errors="replace").rstrip()
                output_lines[level].append(text_line)
                await log(text_line, level)

        stdout_task = asyncio.create_task(stream(proc.stdout, "stdout"))
        stderr_task = asyncio.create_task(stream(proc.stderr, "stderr"))
        try:
            exit_code = await asyncio.wait_for(proc.wait(), timeout=600)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise
        finally:
            manual_run_processes.pop(run_id, None)
        await asyncio.gather(stdout_task, stderr_task)

        if run_id in cancelled_manual_runs:
            cancelled_manual_runs.discard(run_id)
            await log("$ Execution stopped by user.", "stderr")
            return

        await log("─" * 60)
        await log(f"$ Exit code: {exit_code}")
        from app.services.junit_parser import TestResultBuilder
        try:
            if junit_path.is_file():
                parsed_results = TestResultBuilder.from_junit_output(
                    junit_path.read_text(encoding="utf-8", errors="replace"),
                    "\n".join(output_lines["stdout"]),
                    "\n".join(output_lines["stderr"]),
                )
            else:
                parsed_results = TestResultBuilder.from_raw_output(
                    "\n".join(output_lines["stdout"]),
                    "\n".join(output_lines["stderr"]),
                    "bruno",
                )
        except Exception:
            parsed_results = {
                "test_results": [],
                "total_tests": 0,
                "passed_tests": 0,
                "failed_tests": 0,
                "skipped_tests": 0,
            }

        if not parsed_results["test_results"]:
            parsed_results["test_results"] = [{
                "test_name": run_collection,
                "class_name": "Bruno collection",
                "status": "passed" if exit_code == 0 else "failed",
                "duration_ms": None,
                "error_message": None if exit_code == 0 else "Bruno returned a non-zero exit code.",
                "stack_trace": None,
            }]
            parsed_results["total_tests"] = 1
            parsed_results["passed_tests"] = int(exit_code == 0)
            parsed_results["failed_tests"] = int(exit_code != 0)

        db = SessionLocal()
        try:
            run = db.query(AnalyticsRun).filter(AnalyticsRun.id == manual_run_id).first()
            if run:
                run.results_json = parsed_results["test_results"]
                run.total_tests = parsed_results["total_tests"]
                run.passed_tests = parsed_results["passed_tests"]
                run.failed_tests = parsed_results["failed_tests"]
                run.skipped_tests = parsed_results["skipped_tests"]
                run.details_json = _bruno_run_details(argv, run_collection, run_environment, bruno_started,
                                                      exit_code, artifact_dir, (junit_path, json_path))
                db.commit()
        finally:
            db.close()
        report = await allure.build_run_report(
            manual_run_id, allure.adapter_sources(repo_path, [collection_dir / "allure-results"]),
            bruno_started.replace(tzinfo=timezone.utc).timestamp())
        await log(f"$ Allure report: {report['message']}")
        if exit_code == 0:
            await log("$ ✓ Tests PASSED")
            await set_status("passed")
        else:
            await log("$ ✗ Tests FAILED", "stderr")
            await set_status("failed")

    except asyncio.TimeoutError:
        await log("$ Timed out waiting for process to finish.", "stderr")
        await set_status("error")
    except Exception as exc:
        await log(f"$ Execution error: {exc}", "stderr")
        await set_status("error")


APPIUM_RUN_TIMEOUT_SECONDS = 4 * 60 * 60


_APPIUM_LOG_FLUSH_LINES = 100


_APPIUM_LOG_FLUSH_SECONDS = 1.0


_APPIUM_POLL_SECONDS = 0.5


# Appium runs can take hours, so their process id and output position are kept
# on disk; after a backend restart the run is re-attached (live log, Stop, results).
def _run_registry_path() -> Path:
    from app.core.config import settings as app_settings

    directory = Path(app_settings.ARTIFACTS_DIR)
    directory.mkdir(parents=True, exist_ok=True)
    return directory / "manual-run-processes.json"


def _load_run_registry() -> dict:
    try:
        return json.loads(_run_registry_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _save_run_registry(registry: dict) -> None:
    path = _run_registry_path()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(registry, indent=2), encoding="utf-8")
    tmp.replace(path)


def _update_run_registry(run_id: str, entry: Optional[dict]) -> None:
    registry = _load_run_registry()
    if entry is None:
        registry.pop(run_id, None)
    else:
        registry[run_id] = {**registry.get(run_id, {}), **entry}
    _save_run_registry(registry)


class _ManualRunLogger:
    """Streams log lines to WebSocket clients and live.log; batches DB writes."""

    def __init__(self, run_id: str, manual_run_id: int, artifact_dir: Path):
        import time as time_module

        self._clock = time_module.monotonic
        self.run_id = run_id
        self.manual_run_id = manual_run_id
        self.artifact_dir = artifact_dir
        self.pending: list[dict] = []
        self.last_flush = self._clock()

    def flush(self) -> None:
        _append_manual_run_logs(self.manual_run_id, self.pending)
        self.pending.clear()
        self.last_flush = self._clock()

    async def log(self, text: str, level: str = "stdout") -> None:
        payload = {"type": level, "data": text, "timestamp": datetime.utcnow().isoformat()}
        self.pending.append(payload)
        _append_manual_run_artifact_log(self.artifact_dir, payload)
        await _broadcast_manual_run_message(self.run_id, payload)
        if len(self.pending) >= _APPIUM_LOG_FLUSH_LINES or self._clock() - self.last_flush >= _APPIUM_LOG_FLUSH_SECONDS:
            await asyncio.to_thread(self.flush)

    async def finish(self, status: str) -> None:
        await asyncio.to_thread(self.flush)
        await _set_manual_run_status(self.run_id, self.manual_run_id, self.artifact_dir, status)


async def _execute_appium_run_background(run_id: str, manual_run_id: int, repo_path: Path, plan) -> None:
    """Start an Appium Cucumber runner / TestNG suite with Maven and follow it."""
    import time as time_module

    from app.services import appium_project_service as appium

    artifact_dir = _manual_run_artifact_dir(repo_path, run_id)
    logger = _ManualRunLogger(run_id, manual_run_id, artifact_dir)
    started = time_module.time()
    try:
        await logger.log(f"$ Working dir: {plan.cwd}")
        await logger.log(f"$ Command:     {' '.join(plan.argv)}")
        if plan.java_home:
            await logger.log(f"$ JAVA_HOME:   {plan.java_home}")
        for warning in plan.warnings:
            await logger.log(f"$ Warning: {warning}", "stderr")
        await logger.log("─" * 60)

        # Read the installed app version before the tests run (they may reinstall/remove it).
        app_before = await appium.detect_app_version(plan.meta)
        if app_before:
            await logger.log(f"$ App under test: {app_before.get('name')} {app_before.get('version') or ''}"
                             f" ({app_before.get('build') or '?'})")

        artifact_dir.mkdir(parents=True, exist_ok=True)
        # Output goes to a file (not a pipe) so the run survives a backend restart.
        with open(artifact_dir / "process.log", "wb") as output:
            proc = await asyncio.create_subprocess_exec(
                *plan.argv,
                cwd=plan.cwd,
                env=plan.env,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=output,
                stderr=asyncio.subprocess.STDOUT,
                **appium.process_group_kwargs(),
            )
    except Exception as exc:
        await logger.log(f"$ Execution error: {exc}", "stderr")
        await logger.finish("error")
        return

    manual_run_processes[run_id] = proc.pid
    seed = {"meta": plan.meta, "command": plan.argv, "java_home": plan.java_home, "app_before": app_before}
    _update_run_registry(run_id, {
        "manual_run_id": manual_run_id,
        "pid": proc.pid,
        "repo_path": str(repo_path),
        "artifact_dir": str(artifact_dir),
        "started": started,
        "label": plan.label,
        "offset": 0,
        "seed": seed,
    })
    await _follow_appium_run(run_id, manual_run_id, repo_path, artifact_dir, started, plan.label,
                             proc.pid, proc.wait, logger, offset=0, seed=seed)


async def _follow_appium_run(
    run_id: str,
    manual_run_id: int,
    repo_path: Path,
    artifact_dir: Path,
    started: float,
    label: str,
    pid: int,
    wait,
    logger: _ManualRunLogger,
    offset: int,
    seed: Optional[dict] = None,
) -> None:
    """Tail the run's output file until the process exits, then record results.

    ``wait`` is the child's ``wait`` coroutine function, or ``None`` when the
    process was re-attached after a backend restart (exit code unknown).
    """
    import time as time_module

    from app.services import appium_project_service as appium

    output_path = artifact_dir / "process.log"
    pending_bytes = b""
    exit_code = None
    timed_out = False

    async def pump() -> None:
        nonlocal offset, pending_bytes
        if not output_path.is_file():
            return
        with open(output_path, "rb") as handle:
            handle.seek(offset)
            chunk = handle.read()
        if not chunk:
            return
        offset += len(chunk)
        pending_bytes += chunk
        *complete, pending_bytes = pending_bytes.split(b"\n")
        for raw in complete:
            text_line = raw.decode("utf-8", errors="replace").rstrip("\r")
            await logger.log(text_line, "stderr" if "[ERROR]" in text_line else "stdout")
        _update_run_registry(run_id, {"offset": offset})

    wait_task = asyncio.create_task(wait()) if wait else None
    try:
        while True:
            await pump()
            if wait_task is not None:
                if wait_task.done():
                    exit_code = wait_task.result()
                    break
            elif not appium.pid_alive(pid):
                break
            if time_module.time() - started > APPIUM_RUN_TIMEOUT_SECONDS:
                timed_out = True
                appium.terminate_process_tree(pid)
                break
            await asyncio.sleep(_APPIUM_POLL_SECONDS)
        await pump()
        if pending_bytes:
            await logger.log(pending_bytes.decode("utf-8", errors="replace").rstrip(), "stdout")
    except Exception as exc:
        await logger.log(f"$ Execution error: {exc}", "stderr")
        await logger.finish("error")
        return
    finally:
        manual_run_processes.pop(run_id, None)
        _update_run_registry(run_id, None)

    if run_id in cancelled_manual_runs:
        cancelled_manual_runs.discard(run_id)
        await logger.log("$ Execution stopped by user.", "stderr")
        logger.flush()
        return
    if timed_out:
        await logger.log("$ Timed out waiting for the run to finish; the execution was stopped.", "stderr")
        await logger.finish("error")
        return
    if (seed or {}).get("kind") == "framework":
        await _finish_framework_run(repo_path, manual_run_id, artifact_dir, started, exit_code, seed or {}, logger)
        return

    await logger.log("─" * 60)
    exit_text = exit_code if exit_code is not None else "unknown (backend restarted during the run)"
    await logger.log(f"$ Exit code: {exit_text}")
    try:
        parsed = appium.collect_surefire_results(repo_path, started)
        if not parsed:
            ok = exit_code == 0
            parsed = {
                "test_results": [{
                    "test_name": label,
                    "class_name": "Appium run",
                    "status": "passed" if ok else "failed" if exit_code is not None else "error",
                    "duration_ms": None,
                    "error_message": None if ok else (
                        "Maven returned a non-zero exit code (see logs)." if exit_code is not None
                        else "No test reports were found and the exit code is unknown."
                    ),
                    "stack_trace": None,
                }],
                "total_tests": 1,
                "passed_tests": int(ok),
                "failed_tests": int(not ok),
                "skipped_tests": 0,
            }
        db = SessionLocal()
        try:
            run = db.query(AnalyticsRun).filter(AnalyticsRun.id == manual_run_id).first()
            if run:
                run.results_json = parsed["test_results"]
                run.total_tests = parsed["total_tests"]
                run.passed_tests = parsed["passed_tests"]
                run.failed_tests = parsed["failed_tests"]
                run.skipped_tests = parsed["skipped_tests"]
                db.commit()
        finally:
            db.close()
        report = await allure.build_run_report(manual_run_id, allure.adapter_sources(repo_path), started)
        await logger.log(f"$ Allure report: {report['message']} ({report.get('source', '')})")
        await _record_appium_run_details(run_id, manual_run_id, repo_path, artifact_dir, started, exit_code,
                                         seed or {}, logger)
    except Exception as exc:
        await logger.log(f"$ Could not collect results: {exc}", "stderr")
        await logger.finish("error")
        return

    passed = parsed["failed_tests"] == 0 and (exit_code == 0 or (exit_code is None and parsed["passed_tests"] > 0))
    if passed:
        await logger.log("$ ✓ Tests PASSED")
        await logger.finish("passed")
    else:
        await logger.log("$ ✗ Tests FAILED", "stderr")
        await logger.finish("failed")


async def _finish_framework_run(repo_path: Path, manual_run_id: int, artifact_dir: Path, started: float, exit_code,
                                seed: dict, logger: _ManualRunLogger) -> None:
    from app.services import framework_run_service

    # Setup steps (npm install, .venv, ...) change what detection reports.
    _forget_framework_detection(repo_path)
    await logger.log("─" * 60)
    exit_text = exit_code if exit_code is not None else "unknown (backend restarted during the run)"
    await logger.log(f"$ Exit code: {exit_text}")
    try:
        parsed, details = await asyncio.to_thread(
            framework_run_service.collect_results, seed, artifact_dir, started, exit_code,
        )
        await logger.log(f"$ Results from {parsed['source']}: {parsed['passed_tests']} passed, "
                         f"{parsed['failed_tests']} failed, {parsed['skipped_tests']} skipped")
        for report in details.get("reports", []):
            await logger.log(f"$ Report saved: {report['name']}")
        db = SessionLocal()
        try:
            run = db.query(AnalyticsRun).filter(AnalyticsRun.id == manual_run_id).first()
            if run:
                run.results_json = parsed["test_results"]
                run.total_tests = parsed["total_tests"]
                run.passed_tests = parsed["passed_tests"]
                run.failed_tests = parsed["failed_tests"]
                run.skipped_tests = parsed["skipped_tests"]
                run.details_json = details
                db.commit()
        finally:
            db.close()
        report = await allure.build_run_report(manual_run_id, allure.adapter_sources(repo_path), started)
        await logger.log(f"$ Allure report: {report['message']} ({report.get('source', '')})")
    except Exception as exc:
        await logger.log(f"$ Could not collect results: {exc}", "stderr")
        await logger.finish("error")
        return

    passed = parsed["failed_tests"] == 0 and (exit_code == 0 or (exit_code is None and parsed["passed_tests"] > 0))
    if passed:
        await logger.log("$ ✓ Run PASSED")
        await logger.finish("passed")
    else:
        await logger.log("$ ✗ Run FAILED", "stderr")
        await logger.finish("failed")


async def _execute_framework_run_background(run_id: str, manual_run_id: int, repo_path: Path, plan) -> None:
    """Start any detected framework command and follow it like an Appium run (restart-safe)."""
    import time as time_module

    from app.services import appium_project_service as appium

    artifact_dir = _manual_run_artifact_dir(repo_path, run_id)
    logger = _ManualRunLogger(run_id, manual_run_id, artifact_dir)
    started = time_module.time()
    try:
        await logger.log(f"$ Framework:   {plan.seed.get('framework')}")
        await logger.log(f"$ Working dir: {plan.cwd}")
        await logger.log(f"$ Command:     {' '.join(plan.argv)}")
        for warning in plan.warnings:
            await logger.log(f"$ Warning: {warning}", "stderr")
        await logger.log("─" * 60)
        artifact_dir.mkdir(parents=True, exist_ok=True)
        with open(artifact_dir / "process.log", "wb") as output:
            proc = await asyncio.create_subprocess_exec(
                *plan.argv,
                cwd=plan.cwd,
                env=plan.env,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=output,
                stderr=asyncio.subprocess.STDOUT,
                **appium.process_group_kwargs(),
            )
    except Exception as exc:
        await logger.log(f"$ Execution error: {exc}", "stderr")
        await logger.finish("error")
        return

    manual_run_processes[run_id] = proc.pid
    _update_run_registry(run_id, {
        "manual_run_id": manual_run_id,
        "pid": proc.pid,
        "repo_path": str(repo_path),
        "artifact_dir": str(artifact_dir),
        "started": started,
        "label": plan.label,
        "offset": 0,
        "seed": plan.seed,
    })
    await _follow_appium_run(run_id, manual_run_id, repo_path, artifact_dir, started, plan.label,
                             proc.pid, proc.wait, logger, offset=0, seed=plan.seed)


async def _start_framework_run(
    run: AnalyticsRun,
    run_id: str,
    repo_path: Path,
    payload: AnalyticsRunExecuteRequest,
    current_user,
    db: Session,
) -> dict:
    from app.services import framework_run_service

    target = (payload.framework_target or (run.collection_path or "").removeprefix(
        framework_run_service.FRAMEWORK_TARGET_PREFIX)).strip()
    if not target:
        raise HTTPException(status_code=400, detail="Select what to run.")
    if (payload.extra_args or "").strip():  # extra command-line arguments need edit rights
        ensure(db, current_user, "code.edit")
    suite = db.query(AnalyticsSuite).filter(AnalyticsSuite.id == run.suite_id).first()
    environment = None
    if payload.environment_id is not None:
        environment = db.query(TestEnvironment).filter(TestEnvironment.id == payload.environment_id).first()
        if not environment or not suite or environment.project_id != suite.project_id:
            raise HTTPException(status_code=400, detail="That environment is not one of this project's.")
    if run_id in manual_run_processes:
        raise HTTPException(status_code=409, detail="This run is already executing.")
    artifact_dir = _manual_run_artifact_dir(repo_path, run_id)
    if artifact_dir.exists():
        shutil.rmtree(artifact_dir, ignore_errors=True)
    try:
        plan = await asyncio.to_thread(framework_run_service.build_plan, repo_path, target, artifact_dir,
                                       payload.extra_args, environment.variables if environment else None)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    _forget_framework_detection(repo_path)

    run.status = "running"
    run.started_at = datetime.utcnow()
    run.finished_at = None
    run.environment_id = environment.id if environment else None
    run.collection_path = f"{framework_run_service.FRAMEWORK_TARGET_PREFIX}{plan.target}"
    run.environment = plan.seed.get("framework")
    run.collection = f"{plan.label} - {run.started_at.strftime('%Y-%m-%d %H:%M:%S')}"
    run.logs_json = []
    run.results_json = []
    run.details_json = None
    db.commit()

    _write_manual_run_metadata(artifact_dir, {
        "run_id": run_id,
        "name": run.collection,
        "collection_path": run.collection_path,
        "environment": run.environment,
        "branch": run.branch or "main",
        "status": "running",
        "started_at": run.started_at.isoformat(),
        "command": plan.argv,
        "extra_args": payload.extra_args or "",
    })
    _spawn_run_task(_execute_framework_run_background(run_id, run.id, repo_path, plan))
    return {"status": "scheduled", "run_id": run_id, "task_id": f"local-{run.id}",
            "message": f"Run started: {plan.label}"}


def _manual_run_is_active(manual_run_id: int) -> bool:
    db = SessionLocal()
    try:
        run = db.query(AnalyticsRun).filter(AnalyticsRun.id == manual_run_id).first()
        return bool(run and run.status in ("running", "pending"))
    finally:
        db.close()


async def _record_appium_run_details(run_id: str, manual_run_id: int, repo_path: Path, artifact_dir: Path,
                                     started: float, exit_code, seed: dict, logger: _ManualRunLogger) -> None:
    """Store app version, device, technology and generated reports for the Run details tab."""
    import time as time_module

    from app.services import appium_project_service as appium

    try:
        details = await appium.build_run_details(
            repo_path, artifact_dir, seed.get("meta") or {}, started, time_module.time(), exit_code,
            seed.get("app_before"), seed.get("java_home"), seed.get("command") or [],
        )
    except Exception as exc:
        await logger.log(f"$ Could not collect run details: {exc}", "stderr")
        return
    details["artifact_dir"] = str(artifact_dir)
    app = details.get("app") or {}
    if app:
        await logger.log(f"$ App version: {app.get('name')} {app.get('version') or ''} ({app.get('build') or '?'})")
    for report in details.get("reports", []):
        await logger.log(f"$ Report generated: {report['source']}")
    db = SessionLocal()
    try:
        run = db.query(AnalyticsRun).filter(AnalyticsRun.id == manual_run_id).first()
        if run:
            run.details_json = details
            db.commit()
    finally:
        db.close()


async def resume_orphaned_manual_runs() -> None:
    """Re-attach Appium executions that were running when the backend restarted."""
    import time as time_module

    from app.services import appium_project_service as appium

    for run_id, entry in _load_run_registry().items():
        try:
            manual_run_id = int(entry["manual_run_id"])
            pid = int(entry["pid"])
            repo_path = Path(entry["repo_path"])
            artifact_dir = Path(entry["artifact_dir"])
        except (KeyError, TypeError, ValueError):
            _update_run_registry(run_id, None)
            continue
        if not _manual_run_is_active(manual_run_id):
            _update_run_registry(run_id, None)
            continue
        logger = _ManualRunLogger(run_id, manual_run_id, artifact_dir)
        alive = appium.pid_alive(pid) and appium.owns_process_group(pid)
        if alive:
            manual_run_processes[run_id] = pid
            await logger.log(f"$ Backend restarted — re-attached to the running execution (pid {pid}).")
        else:
            await logger.log("$ Backend restarted — the execution already finished; collecting results.")
        _spawn_run_task(_follow_appium_run(
            run_id, manual_run_id, repo_path, artifact_dir,
            float(entry.get("started") or time_module.time()), str(entry.get("label") or run_id),
            pid if alive else -1, None, logger, int(entry.get("offset") or 0), entry.get("seed"),
        ))


async def _start_appium_run(
    run: AnalyticsRun,
    run_id: str,
    repo_path: Path,
    payload: AnalyticsRunExecuteRequest,
    db: Session,
) -> dict:
    from app.services import appium_project_service as appium

    stored_target = (run.collection_path or "").removeprefix(appium.APPIUM_TARGET_PREFIX)
    stored_env, _, stored_device = (run.environment or "").partition(" / ")
    try:
        plan = await appium.build_run_plan(
            repo_path,
            (payload.appium_target or stored_target).strip(),
            (payload.app_env or stored_env).strip(),
            (payload.device_run_option or stored_device).strip(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if run_id in manual_run_processes:
        raise HTTPException(status_code=409, detail="This run is already executing.")

    run.status = "running"
    run.started_at = datetime.utcnow()
    run.finished_at = None
    run.collection_path = f"{appium.APPIUM_TARGET_PREFIX}{plan.target}"
    run.environment = f"{plan.app_env} / {plan.device_run_option}"
    run.collection = f"{plan.label} - {run.environment} - {run.started_at.strftime('%Y-%m-%d %H:%M:%S')}"
    run.logs_json = []
    db.commit()

    artifact_dir = _manual_run_artifact_dir(repo_path, run_id)
    _write_manual_run_metadata(artifact_dir, {
        "run_id": run_id,
        "name": run.collection,
        "collection_path": run.collection_path,
        "environment": run.environment,
        "branch": run.branch or "main",
        "status": "running",
        "started_at": run.started_at.isoformat(),
        "command": plan.argv,
        "allure_results_dir": str(artifact_dir / "allure-results"),
    })
    _spawn_run_task(_execute_appium_run_background(run_id, run.id, repo_path, plan))
    return {"status": "scheduled", "run_id": run_id, "task_id": f"local-{run.id}",
            "message": f"Appium run started: {plan.label}"}


_FRAMEWORK_DETECTION_TTL_SECONDS = 60


_framework_detection_cache: dict[str, tuple[float, dict]] = {}


def _forget_framework_detection(repo_path: Path) -> None:
    _framework_detection_cache.pop(str(repo_path), None)
