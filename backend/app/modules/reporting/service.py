"""Allure report storage and serialisation."""
import json
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.modules.projects.models import AllureReport


def _allure_results_from_json_entries(entries) -> list[dict]:
    results = []
    for entry in entries:
        try:
            data = json.loads(entry)
        except (TypeError, ValueError):
            continue
        if not isinstance(data, dict) or not data.get("status") or not (data.get("name") or data.get("fullName")):
            continue
        status = str(data.get("status") or "unknown").lower()
        duration = data.get("duration")
        if not isinstance(duration, (int, float)):
            start, stop = data.get("start"), data.get("stop")
            duration = stop - start if isinstance(start, (int, float)) and isinstance(stop, (int, float)) else 0
        details = data.get("statusDetails") if isinstance(data.get("statusDetails"), dict) else {}
        results.append({
            "name": str(data.get("fullName") or data.get("name")),
            "class_name": str(data.get("historyId") or "") or None,
            "status": status,
            "duration_ms": max(0, int(duration or 0)),
            "message": str(details.get("message") or "") or None,
        })
    return results


def _save_allure_report(
    db: Session,
    project_id: int,
    source: str,
    external_id: str,
    name: str,
    results: list[dict],
    branch: Optional[str] = None,
    workflow_name: Optional[str] = None,
    report_url: Optional[str] = None,
    occurred_at: Optional[datetime] = None,
) -> bool:
    report = db.query(AllureReport).filter(
        AllureReport.project_id == project_id,
        AllureReport.source == source,
        AllureReport.external_id == external_id,
    ).first()
    created = report is None
    if report is None:
        report = AllureReport(project_id=project_id, source=source, external_id=external_id, name=name)
        db.add(report)
    # Reflect the real run date (not just import time) so date filtering,
    # sorting and "execution time" stay accurate for GitHub Actions imports.
    if occurred_at is not None:
        report.created_at = occurred_at

    status_counts = {status: 0 for status in ("passed", "failed", "broken", "skipped")}
    for result in results:
        status = result["status"]
        if status in status_counts:
            status_counts[status] += 1
    report.name = name
    report.branch = branch
    report.workflow_name = workflow_name
    report.report_url = report_url
    report.total_tests = len(results)
    report.passed_tests = status_counts["passed"]
    report.failed_tests = status_counts["failed"]
    report.broken_tests = status_counts["broken"]
    report.skipped_tests = status_counts["skipped"]
    report.duration_ms = sum(result["duration_ms"] for result in results)
    report.results_json = results
    return created


def _allure_report_response(report: AllureReport) -> dict:
    return {
        "id": report.id,
        "source": report.source,
        "name": report.name,
        "branch": report.branch,
        "workflow_name": report.workflow_name,
        "report_url": report.report_url,
        "total_tests": report.total_tests,
        "passed_tests": report.passed_tests,
        "failed_tests": report.failed_tests,
        "broken_tests": report.broken_tests,
        "skipped_tests": report.skipped_tests,
        "duration_ms": report.duration_ms,
        "created_at": report.created_at.isoformat() if report.created_at else None,
        "results": report.results_json or [],
    }


def _allure_run_status(report: AllureReport) -> str:
    if report.failed_tests or report.broken_tests:
        return "failed"
    if report.passed_tests:
        return "passed"
    return "skipped"


def _allure_run_response(report: AllureReport) -> dict:
    return {
        "id": f"allure-{report.id}",
        "suite_id": f"allure-suite-{report.project_id}",
        "status": _allure_run_status(report),
        "branch": report.branch,
        "commit_sha": None,
        "triggered_by": report.workflow_name or "Allure import",
        "source": report.source,
        "collection": report.name,
        "started_at": report.created_at.isoformat() if report.created_at else None,
        "finished_at": report.imported_at.isoformat() if report.imported_at else None,
        "total_tests": report.total_tests,
        "passed_tests": report.passed_tests,
        "failed_tests": report.failed_tests + report.broken_tests,
        "skipped_tests": report.skipped_tests,
        "created_at": report.created_at.isoformat() if report.created_at else datetime.utcnow().isoformat(),
    }
