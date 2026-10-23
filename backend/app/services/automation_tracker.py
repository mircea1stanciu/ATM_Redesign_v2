"""
File-based tracker for test case automation status.

Stores per-project JSON in ARTIFACTS_DIR/test_automation/{PROJECT_KEY}.json

Status values
─────────────
  "pending"      — not yet classified (default; not written to disk)
  "to_automate"  — manual test that should be automated
  "automated"    — already has automated coverage
  "manual"       — intentionally kept as manual only
"""
import json
import os
from datetime import datetime, timezone
from typing import Any

VALID_STATUSES = frozenset({"pending", "to_automate", "automated", "manual"})


class AutomationTracker:
    def __init__(self, artifacts_dir: str):
        self.base_dir = os.path.join(artifacts_dir, "test_automation")
        os.makedirs(self.base_dir, exist_ok=True)

    def _path(self, project_key: str) -> str:
        return os.path.join(self.base_dir, f"{project_key.upper()}.json")

    def load(self, project_key: str) -> dict[str, dict[str, Any]]:
        """Load all tracked statuses for a project (key → {status, ...})."""
        path = self._path(project_key)
        if not os.path.exists(path):
            return {}
        try:
            with open(path) as f:
                return json.load(f)
        except Exception:
            return {}

    def update(self, project_key: str, jira_key: str, status: str, updated_by: str = "") -> None:
        """Persist automation status for a single issue.

        Setting status to "pending" removes the entry (pending is the default).
        """
        if status not in VALID_STATUSES:
            raise ValueError(f"Invalid status '{status}'. Must be one of: {', '.join(sorted(VALID_STATUSES))}")

        data = self.load(project_key)
        if status == "pending":
            data.pop(jira_key, None)
        else:
            data[jira_key] = {
                "status": status,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "updated_by": updated_by,
            }
        with open(self._path(project_key), "w") as f:
            json.dump(data, f, indent=2)
