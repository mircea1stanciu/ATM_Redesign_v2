"""One Allure pipeline for every runner (docs/redesign/03-target-architecture.md, section 3.6).

1. Results first: a run's ``allure-results`` come from the framework's own Allure adapter when it wrote some during
   the run (Playwright, pytest, JUnit/TestNG, Cucumber), otherwise ATM converts its parsed results (JUnit XML,
   Bruno, Newman, k6) into Allure result files.
2. Then ``allure generate``, with ``history/`` copied from the previous report of the same suite, so trends work.
3. Reports live under ``ARTIFACTS_DIR/reports``, not in someone's checkout, so everyone who may see the run can open
   its report.
"""
import asyncio
import json
import logging
import shutil
import time
import uuid
from pathlib import Path
from typing import Optional

from app.core.config import settings
from app.core.db import SessionLocal
from app.modules.projects.models import AllureReport, AnalyticsRun, AnalyticsSuite, TestEnvironment

logger = logging.getLogger("atm.reports")

GENERATE_TIMEOUT_SECONDS = 300
ADAPTER_DIRS = ("allure-results", "target/allure-results", "build/allure-results")
STATUS_MAP = {"passed": "passed", "skipped": "skipped", "failed": "failed"}


def reports_root() -> Path:
    return Path(settings.ARTIFACTS_DIR) / "reports"


def run_report_dir(project_id: int, suite_id: int, run_id: int) -> Path:
    return reports_root() / f"project-{project_id}" / f"suite-{suite_id}" / f"run-{run_id}"


def imported_report_dir(project_id: int, report_id: int) -> Path:
    return reports_root() / f"project-{project_id}" / "imported" / f"report-{report_id}"


def allure_binary() -> Optional[str]:
    return shutil.which("allure")


# ── Results ───────────────────────────────────────────────────────────────────


def copy_adapter_results(sources: list[Path], since: float, target: Path) -> int:
    """Copy the Allure files an adapter wrote during the run (newer than ``since``) into ``target``."""
    copied = 0
    for source in sources:
        if not source.is_dir():
            continue
        for path in source.iterdir():
            if path.is_file() and path.stat().st_mtime >= since - 1:
                target.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, target / path.name)
                copied += 1
    return copied


def write_converted_results(target: Path, results: list[dict], labels: dict[str, str], started_ms: int) -> int:
    """Allure result files from ATM's parsed results (JUnit, Bruno, Newman, k6, console summaries)."""
    target.mkdir(parents=True, exist_ok=True)
    clock = started_ms
    for result in results:
        status = STATUS_MAP.get(str(result.get("status") or "").lower(), "broken")
        duration = int(result.get("duration_ms") or 0)
        name = str(result.get("test_name") or result.get("name") or "Unnamed test")
        group = str(result.get("class_name") or labels.get("suite") or "Tests")
        full_name = f"{group}.{name}"
        payload = {
            "uuid": str(uuid.uuid4()),
            "historyId": full_name,  # the same test in later runs: Allure's history and retries
            "name": name,
            "fullName": full_name,
            "status": status,
            "statusDetails": {"message": result.get("error_message") or result.get("message") or "",
                              "trace": result.get("stack_trace") or ""},
            "start": clock,
            "stop": clock + duration,
            "labels": [{"name": "suite", "value": group}, {"name": "parentSuite", "value": labels.get("suite", "")},
                       *({"name": key, "value": value} for key, value in labels.items()
                         if key in ("framework", "tag") and value)],
        }
        clock += duration
        (target / f"{payload['uuid']}-result.json").write_text(json.dumps(payload), encoding="utf-8")
    return len(results)


def write_run_info(target: Path, environment: dict[str, str], executor: dict) -> None:
    """environment.properties (shown on the report's overview) and executor.json (orders the history)."""
    lines = [f"{key.replace(' ', '.')}={value}" for key, value in environment.items() if value]
    (target / "environment.properties").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (target / "executor.json").write_text(json.dumps(executor), encoding="utf-8")


def previous_history(suite_dir: Path, current: Path) -> Optional[Path]:
    """The ``history`` folder of the suite's most recent other report."""
    reports = [d for d in suite_dir.glob("run-*") if d != current and (d / "allure-report" / "history").is_dir()]
    if not reports:
        return None
    latest = max(reports, key=lambda d: (d / "allure-report").stat().st_mtime)
    return latest / "allure-report" / "history"


async def generate(results_dir: Path, report_dir: Path, history: Optional[Path]) -> tuple[bool, str]:
    """Run ``allure generate``; returns (ok, message)."""
    binary = allure_binary()
    if not binary:
        return False, "The Allure command line is not installed on this station (it needs Java)."
    if history and history.is_dir():
        shutil.copytree(history, results_dir / "history", dirs_exist_ok=True)
    proc = await asyncio.create_subprocess_exec(
        binary, "generate", str(results_dir), "-o", str(report_dir), "--clean",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    try:
        output, _ = await asyncio.wait_for(proc.communicate(), timeout=GENERATE_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return False, "Allure took too long to generate the report."
    text = output.decode("utf-8", errors="replace").strip()
    if proc.returncode != 0 or not (report_dir / "index.html").is_file():
        return False, f"allure generate failed: {text[-500:]}"
    return True, "ready"


# ── Runs ──────────────────────────────────────────────────────────────────────


def _load_run(manual_run_id: int) -> Optional[dict]:
    with SessionLocal() as db:
        run = db.query(AnalyticsRun).filter(AnalyticsRun.id == manual_run_id).first()
        suite = db.query(AnalyticsSuite).filter(AnalyticsSuite.id == run.suite_id).first() if run else None
        if not run or not suite:
            return None
        environment = db.query(TestEnvironment).filter(TestEnvironment.id == run.environment_id).first() \
            if run.environment_id else None
        build_order = db.query(AnalyticsRun).filter(AnalyticsRun.suite_id == suite.id,
                                                    AnalyticsRun.id <= run.id).count()
        return {
            "project_id": suite.project_id, "suite_id": suite.id, "suite": suite.name, "test_type": suite.test_type,
            "name": run.name or run.collection or f"Run #{run.id}", "results": list(run.results_json or []),
            "branch": run.branch or "", "environment": environment.name if environment else "",
            "framework": (run.details_json or {}).get("framework") or run.environment or "",
            "build_order": build_order,
        }


def _save_report_status(manual_run_id: int, status: dict) -> None:
    with SessionLocal() as db:
        run = db.query(AnalyticsRun).filter(AnalyticsRun.id == manual_run_id).first()
        if run:
            run.details_json = {**(run.details_json or {}), "report": status}
            db.commit()


async def build_run_report(manual_run_id: int, adapter_sources: list[Path], started: float) -> dict:
    """allure-results + allure generate for a finished run; the outcome is saved in the run's details."""
    info = await asyncio.to_thread(_load_run, manual_run_id)
    if info is None:
        return {"status": "failed", "message": "Run not found."}
    run_dir = run_report_dir(info["project_id"], info["suite_id"], manual_run_id)
    results_dir, report_dir = run_dir / "allure-results", run_dir / "allure-report"
    shutil.rmtree(run_dir, ignore_errors=True)
    results_dir.mkdir(parents=True)
    copied = await asyncio.to_thread(copy_adapter_results, adapter_sources, started, results_dir)
    source = "Allure adapter" if copied else "converted by ATM"
    if not copied:
        await asyncio.to_thread(write_converted_results, results_dir, info["results"],
                                {"suite": info["suite"], "framework": info["framework"], "tag": info["test_type"]},
                                int(started * 1000))
    write_run_info(results_dir, {
        "Suite": info["suite"], "Test type": info["test_type"], "Environment": info["environment"],
        "Branch": info["branch"], "Framework": info["framework"], "Results": source,
    }, {"name": "ATM", "type": "atm", "buildName": info["name"], "buildOrder": info["build_order"]})
    ok, message = await generate(results_dir, report_dir, previous_history(run_dir.parent, run_dir))
    status = {"status": "ready" if ok else "unavailable" if not allure_binary() else "failed", "message": message,
              "source": source, "generated_at": time.time()}
    await asyncio.to_thread(_save_report_status, manual_run_id, status)
    if not ok:
        logger.warning("Report of run %s not generated: %s", manual_run_id, message)
    return status


def adapter_sources(repo_path: Path, extra: Optional[list[Path]] = None) -> list[Path]:
    return [*(extra or []), *(repo_path / rel for rel in ADAPTER_DIRS)]


# ── Imported reports (local allure-results folders, GitHub artifacts) ────────


async def build_imported_report(report: AllureReport) -> tuple[bool, str, Path]:
    """Generate the Allure report of an imported result set (once; later views reuse it)."""
    report_root = imported_report_dir(report.project_id, report.id)
    report_dir = report_root / "allure-report"
    if (report_dir / "index.html").is_file():
        return True, "ready", report_dir
    results_dir = report_root / "allure-results"
    shutil.rmtree(report_root, ignore_errors=True)
    results = [{"test_name": r.get("name"), "class_name": r.get("class_name"), "status": r.get("status"),
                "duration_ms": r.get("duration_ms"), "error_message": r.get("message")}
               for r in report.results_json or []]
    started_ms = int(report.created_at.timestamp() * 1000) if report.created_at else int(time.time() * 1000)
    await asyncio.to_thread(write_converted_results, results_dir, results, {"suite": report.name}, started_ms)
    write_run_info(results_dir, {"Source": report.source, "Branch": report.branch or "",
                                 "Workflow": report.workflow_name or ""},
                   {"name": "ATM import", "type": "atm", "buildName": report.name})
    ok, message = await generate(results_dir, report_dir, None)
    return ok, message, report_dir
