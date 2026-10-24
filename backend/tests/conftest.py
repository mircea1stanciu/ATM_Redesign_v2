import os
import tempfile

# Point the app at a throwaway SQLite file before anything imports app.core.config, so tests never touch
# backend/unifiedwork.db.
_db_dir = tempfile.mkdtemp(prefix="atm-tests-")
os.environ["ATM_DATABASE_PATH"] = os.path.join(_db_dir, "test.db")
# Run artifacts and Allure reports go to the throwaway folder too, never to the station's real ARTIFACTS_DIR.
os.environ["ARTIFACTS_DIR"] = os.path.join(_db_dir, "artifacts")
os.environ.pop("ATM_DATABASE_URL", None)
os.environ.pop("ATM_DEV_ADMIN_PASSWORD", None)
# The suite scheduler runs in the app; tests call scheduler.run_due_suites() themselves.
os.environ["ATM_SCHEDULER_ENABLED"] = "false"
