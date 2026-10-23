import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.models import Project, RunStatus, TestResult, TestRun, TestStatus, TestSuite
from app.schemas.test_runs import TestRunCreate
from app.services.docker_runner import DockerTestRunner, TestRunEnvironment
from app.services.framework_detector import FrameworkDetector, TestFramework
from app.services.junit_parser import TestResultBuilder
from app.services.notification_service import NotificationService
from app.services.websocket_manager import connection_manager


class TestRunService:
    @staticmethod
    def _build_bruno_command(
        run_project: Optional[str],
        run_collection: Optional[str],
        run_environment: Optional[str],
    ) -> tuple[Optional[str], Optional[str]]:
        """Build Bruno run command and working directory from selected UI context."""
        if not run_collection or not run_environment:
            return None, None

        selected_project = (run_project or "").strip()
        selected_collection = run_collection.strip().strip("/")
        selected_environment = run_environment.strip()
        if not selected_collection or not selected_environment:
            return None, None

        if not selected_project:
            selected_project = selected_collection.split("/", 1)[0]

        collection_label = selected_collection
        project_prefix = f"{selected_project}/"
        if selected_project and selected_collection.startswith(project_prefix):
            collection_label = selected_collection[len(project_prefix):]

        current_date = datetime.now(timezone.utc).strftime("%d-%m-%Y-%H%M%S")
        command = (
            f"mkdir -p results-{selected_project} && "
            f"bru run -r --sandbox developer "
            f"--env-file environments/{selected_environment}.bru "
            f"--reporter-html results-{selected_project}/{collection_label}-{selected_environment}-{current_date}.html"
        )
        working_dir = f"/workspace/{selected_collection}"
        return command, working_dir

    @staticmethod
    async def create_run(db: AsyncSession, run_data: TestRunCreate) -> TestRun:
        """Create a new test run."""
        run = TestRun(
            id=uuid.uuid4(),
            suite_id=uuid.UUID(str(run_data.suite_id)),
            status=RunStatus.pending,
            branch=run_data.branch,
            commit_sha=run_data.commit_sha,
            triggered_by=run_data.triggered_by,
            source="local",
            collection=run_data.collection,
        )
        db.add(run)
        await db.commit()
        await db.refresh(run)
        return run

    @staticmethod
    async def create_github_action_run(
        db: AsyncSession,
        suite_id: str,
        branch: Optional[str],
        triggered_by: Optional[str],
        collection: Optional[str],
    ) -> TestRun:
        """Create a TestRun record representing a dispatched GitHub Actions run.

        Completion isn't tracked back from GitHub (no webhook wired up yet), so
        the run is recorded as 'running' purely for visibility in the runs list
        / analytics / dashboard.
        """
        run = TestRun(
            id=uuid.uuid4(),
            suite_id=uuid.UUID(str(suite_id)),
            status=RunStatus.running,
            branch=branch,
            triggered_by=triggered_by,
            source="github_actions",
            collection=collection,
            started_at=datetime.now(timezone.utc),
        )
        db.add(run)
        await db.commit()
        await db.refresh(run)
        return run

    @staticmethod
    async def sync_github_action_runs(
        db: AsyncSession,
        suite_id: str,
        runs: list[dict],
    ) -> dict:
        """Upsert a batch of GitHub Actions workflow runs into ``test_runs``.

        Each item in ``runs`` is a normalized dict with keys: ``external_id``,
        ``collection``, ``branch``, ``commit_sha``, ``triggered_by``, ``status``
        (a :class:`RunStatus`), ``started_at``, ``finished_at``, ``created_at``.

        Runs are de-duplicated by ``external_id`` (the GitHub run id) so calling
        this repeatedly refreshes existing rows instead of creating duplicates.
        Returns ``{"created": int, "updated": int}``.
        """
        suite_uuid = uuid.UUID(str(suite_id))
        incoming = [r for r in runs if r.get("external_id")]
        if not incoming:
            return {"created": 0, "updated": 0}

        ext_ids = [str(r["external_id"]) for r in incoming]
        stmt = select(TestRun).where(
            TestRun.suite_id == suite_uuid,
            TestRun.external_id.in_(ext_ids),
        )
        result = await db.execute(stmt)
        existing = {r.external_id: r for r in result.scalars().all()}

        created = 0
        updated = 0
        for r in incoming:
            ext_id = str(r["external_id"])
            row = existing.get(ext_id)
            if row is None:
                row = TestRun(
                    id=uuid.uuid4(),
                    suite_id=suite_uuid,
                    source="github_actions",
                    external_id=ext_id,
                    created_at=r.get("created_at") or datetime.now(timezone.utc),
                )
                db.add(row)
                created += 1
            else:
                updated += 1
            row.status = r.get("status", RunStatus.running)
            row.branch = r.get("branch")
            row.commit_sha = (r.get("commit_sha") or None)
            row.triggered_by = r.get("triggered_by")
            row.collection = r.get("collection")
            row.started_at = r.get("started_at")
            row.finished_at = r.get("finished_at")

        await db.commit()
        return {"created": created, "updated": updated}

    @staticmethod
    async def get_run(db: AsyncSession, run_id: str) -> Optional[TestRun]:
        """Get test run by ID."""
        try:
            run_uuid = uuid.UUID(str(run_id))
        except (ValueError, AttributeError, TypeError):
            return None
        stmt = (
            select(TestRun)
            .where(TestRun.id == run_uuid)
            .options(selectinload(TestRun.results))
        )
        result = await db.execute(stmt)
        return result.scalars().first()

    @staticmethod
    async def list_runs_by_suite(db: AsyncSession, suite_id: str, skip: int = 0, limit: int = 100) -> list[TestRun]:
        """List all test runs for a suite."""
        try:
            suite_uuid = uuid.UUID(str(suite_id))
        except (ValueError, AttributeError, TypeError):
            return []
        stmt = select(TestRun).where(TestRun.suite_id == suite_uuid).offset(skip).limit(limit)
        result = await db.execute(stmt)
        return result.scalars().all()

    @staticmethod
    async def list_runs_by_project(db: AsyncSession, project_id: str, skip: int = 0, limit: int = 100) -> list[TestRun]:
        """List all test runs for a project."""
        try:
            project_uuid = uuid.UUID(str(project_id))
        except (ValueError, AttributeError, TypeError):
            return []
        stmt = select(TestRun).join(
            TestRun.suite
        ).filter_by(project_id=project_uuid).offset(skip).limit(limit)
        result = await db.execute(stmt)
        return result.scalars().all()

    @staticmethod
    async def cancel_run(db: AsyncSession, run_id: str) -> Optional[TestRun]:
        """Cancel a running or pending run."""
        run = await TestRunService.get_run(db, run_id)
        if not run:
            return None
        if run.status in (RunStatus.running, RunStatus.pending):
            run.status = RunStatus.cancelled
            run.finished_at = datetime.now(timezone.utc)
            await db.commit()
            await db.refresh(run)
        return run

    @staticmethod
    async def delete_run(db: AsyncSession, run_id: str) -> bool:
        """Delete a run and all its results/artifacts."""
        run = await TestRunService.get_run(db, run_id)
        if not run:
            return False
        await db.delete(run)
        await db.commit()
        return True

    @staticmethod
    async def execute_test_run(
        db: AsyncSession,
        run_id: uuid.UUID,
        suite_id: uuid.UUID,
        project_id: uuid.UUID,
        branch: str = "main",
        run_project: Optional[str] = None,
        run_collection: Optional[str] = None,
        run_environment: Optional[str] = None,
    ) -> None:
        """
        Execute a test run end-to-end.
        
        Args:
            db: Database session
            run_id: ID of TestRun record
            suite_id: ID of TestSuite
            project_id: ID of Project
            branch: Git branch to test
        """
        test_run = None
        suite = None
        project = None
        try:
            # Fetch test run, suite, and project
            test_run = await db.get(TestRun, run_id)
            if not test_run:
                raise ValueError(f"Test run {run_id} not found")
            
            suite = await db.get(TestSuite, suite_id)
            if not suite:
                raise ValueError(f"Test suite {suite_id} not found")
            
            project = await db.get(Project, project_id)
            if not project:
                raise ValueError(f"Project {project_id} not found")
            
            # Update run status to running
            test_run.status = RunStatus.running
            test_run.started_at = datetime.now(timezone.utc)
            db.add(test_run)
            await db.flush()

            rid = str(run_id)
            
            # Setup environment
            env = TestRunEnvironment(rid)
            runner = DockerTestRunner()
            
            # Clone repository
            await connection_manager.broadcast_log(
                rid, "stdout", f"$ Cloning {project.git_repo_url} (branch: {branch})..."
            )
            repo_path = await runner.clone_repository(project.git_repo_url, branch)
            await connection_manager.broadcast_log(rid, "stdout", "$ Repository cloned.")
            
            try:
                # Detect test framework
                await connection_manager.broadcast_log(rid, "stdout", "$ Detecting test framework...")
                framework = await TestRunService._detect_framework(repo_path)
                await connection_manager.broadcast_log(rid, "stdout", f"$ Framework detected: {framework.value}")

                custom_command = None
                custom_working_dir = None
                if framework == TestFramework.BRUNO:
                    custom_command, custom_working_dir = TestRunService._build_bruno_command(
                        run_project,
                        run_collection,
                        run_environment,
                    )
                    if custom_command:
                        await connection_manager.broadcast_log(rid, "stdout", f"$ Working dir: {custom_working_dir}")
                        await connection_manager.broadcast_log(rid, "stdout", f"$ Command: {custom_command}")
                
                # Run tests
                await connection_manager.broadcast_log(rid, "stdout", "")
                await connection_manager.broadcast_log(rid, "stdout", "$ Running tests...")
                await connection_manager.broadcast_log(rid, "stdout", "─" * 60)
                exit_code, stdout, stderr = await runner.run_tests(
                    framework,
                    repo_path,
                    test_path=((suite.config_json or {}).get("test_path") or "."),
                    timeout=int((suite.config_json or {}).get("timeout_seconds") or 600),
                    custom_command=custom_command,
                    working_dir=custom_working_dir,
                )

                # Stream stdout/stderr to WebSocket
                if stdout:
                    for line in stdout.splitlines():
                        await connection_manager.broadcast_log(rid, "stdout", line)
                if stderr:
                    for line in stderr.splitlines():
                        await connection_manager.broadcast_log(rid, "stderr", line)

                await connection_manager.broadcast_log(rid, "stdout", "─" * 60)
                await connection_manager.broadcast_log(rid, "stdout", f"$ Exit code: {exit_code}")
                
                # Parse results
                await connection_manager.broadcast_log(rid, "stdout", "$ Parsing results...")
                test_results = await TestRunService._parse_results(
                    framework,
                    exit_code,
                    stdout,
                    stderr,
                    env,
                )
                
                # Store results in database
                await TestRunService._store_results(
                    db,
                    test_run,
                    suite,
                    test_results,
                )
                
                # Update run status
                if exit_code == 0:
                    test_run.status = RunStatus.passed
                    await connection_manager.broadcast_log(rid, "stdout", "$ ✓ Tests PASSED")
                else:
                    test_run.status = RunStatus.failed
                    await connection_manager.broadcast_log(rid, "stderr", "$ ✗ Tests FAILED")
                    
            finally:
                runner.cleanup(repo_path)
            
            # Update completion time
            finished = datetime.now(timezone.utc)
            test_run.finished_at = finished
            if test_run.started_at:
                (finished - test_run.started_at).total_seconds()
                test_run.total_tests = test_run.total_tests or 0  # ensure int
            

            if test_run.status in (RunStatus.failed, RunStatus.error):
                await NotificationService.send_failure_notifications(test_run, suite, project)
            db.add(test_run)
            await db.commit()
            
        except Exception as e:
            # Handle execution error
            if test_run:
                test_run.status = RunStatus.error
                test_run.error_message = str(e)
                test_run.finished_at = datetime.now(timezone.utc)
                await connection_manager.broadcast_log(str(run_id), "stderr", f"$ Error: {e}")
                if suite and project:
                    await NotificationService.send_failure_notifications(test_run, suite, project)
                db.add(test_run)
                await db.commit()
            raise

    @staticmethod
    async def _detect_framework(repo_path: str) -> TestFramework:
        """Detect test framework in repository."""
        # Get all files in repo
        file_paths = []
        for root, dirs, files in os.walk(repo_path):
            for file in files:
                rel_path = os.path.relpath(os.path.join(root, file), repo_path)
                file_paths.append(rel_path)
        
        # Try to detect framework
        framework = FrameworkDetector.detect_from_files(file_paths)
        
        if framework != TestFramework.UNKNOWN:
            return framework
        
        # Try content-based detection
        content_dict = {}
        for file_path in file_paths[:50]:  # Sample first 50 files
            full_path = os.path.join(repo_path, file_path)
            if os.path.isfile(full_path) and os.path.getsize(full_path) < 100000:  # < 100KB
                try:
                    with open(full_path, encoding="utf-8", errors="ignore") as f:
                        content_dict[file_path] = f.read()
                except Exception:
                    pass
        
        return FrameworkDetector.detect_from_content(content_dict)

    @staticmethod
    async def _parse_results(
        framework: TestFramework,
        exit_code: int,
        stdout: str,
        stderr: str,
        env: TestRunEnvironment,
    ) -> dict:
        """Parse test results from framework output."""
        # Try to find JUnit XML results
        junit_file = env.get_artifact_path("results.xml")
        
        try:
            if os.path.exists(junit_file):
                with open(junit_file) as f:
                    junit_xml = f.read()
                results = TestResultBuilder.from_junit_output(junit_xml, stdout, stderr)
            else:
                # Fallback to raw output parsing
                results = TestResultBuilder.from_raw_output(stdout, stderr, framework.value)
        except Exception:
            # If parsing fails, return raw output
            results = {
                "test_results": [],
                "total_tests": 0,
                "passed_tests": 0 if exit_code == 0 else 0,
                "failed_tests": 1 if exit_code != 0 else 0,
                "skipped_tests": 0,
                "stdout": stdout,
                "stderr": stderr,
            }
        
        return results

    @staticmethod
    async def _store_results(
        db: AsyncSession,
        test_run: TestRun,
        suite: TestSuite,
        results: dict,
    ) -> None:
        """Store test results in database."""
        # Update run with aggregate metrics
        test_run.total_tests = results.get("total_tests", 0)
        test_run.passed_tests = results.get("passed_tests", 0)
        test_run.failed_tests = results.get("failed_tests", 0)
        test_run.skipped_tests = results.get("skipped_tests", 0)
        
        # Store individual test results
        for result_data in results.get("test_results", []):
            test_result = TestResult(
                id=uuid.uuid4(),
                run_id=test_run.id,
                test_name=result_data.get("test_name", "unknown"),
                class_name=result_data.get("class_name", ""),
                status=result_data.get("status", TestStatus.error.value),
                duration_ms=result_data.get("duration_ms", 0),
                error_message=result_data.get("error_message"),
                stack_trace=result_data.get("stack_trace"),
            )
            db.add(test_result)
        
        db.add(test_run)
        await db.flush()
