import asyncio
import logging
import os
import shutil
import uuid
from datetime import datetime, timedelta
from typing import Optional

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.services.test_run_service import TestRunService
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(
    name="app.workers.tasks.execute_test_run",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
)
def execute_test_run_task(
    self,
    run_id: str,
    suite_id: str,
    project_id: str,
    branch: str = "main",
    run_project: Optional[str] = None,
    run_collection: Optional[str] = None,
    run_environment: Optional[str] = None,
) -> dict:
    """
    Celery task to execute a test run asynchronously.
    
    Args:
        self: Celery task self
        run_id: UUID of test run
        suite_id: UUID of test suite
        project_id: UUID of project
        branch: Git branch to test
        
    Returns:
        Dictionary with execution result
    """
    try:
        # Convert string UUIDs back to UUID objects
        run_uuid = uuid.UUID(run_id)
        suite_uuid = uuid.UUID(suite_id)
        project_uuid = uuid.UUID(project_id)
        
        # Run async function
        async def run_test():
            async with AsyncSessionLocal() as db:
                await TestRunService.execute_test_run(
                    db,
                    run_uuid,
                    suite_uuid,
                    project_uuid,
                    branch,
                    run_project=run_project,
                    run_collection=run_collection,
                    run_environment=run_environment,
                )
        
        # Execute async function
        asyncio.run(run_test())
        
        return {
            "status": "success",
            "run_id": run_id,
            "message": f"Test run {run_id} executed successfully",
        }
        
    except Exception as exc:
        logger.error(f"Test run {run_id} failed: {exc}")
        
        # Retry with exponential backoff
        try:
            raise self.retry(exc=exc, countdown=60 * (2 ** self.request.retries))
        except self.MaxRetriesExceededError:
            logger.error(f"Max retries exceeded for test run {run_id}")
            return {
                "status": "failed",
                "run_id": run_id,
                "error": str(exc),
            }


@celery_app.task(name="app.workers.tasks.cleanup_old_artifacts")
def cleanup_old_artifacts_task() -> dict:
    """
    Celery task to cleanup old test artifacts.
    Removes artifacts older than 7 days.
    
    Returns:
        Dictionary with cleanup statistics
    """
    try:
        artifacts_dir = settings.ARTIFACTS_DIR
        
        if not os.path.exists(artifacts_dir):
            return {
                "status": "success",
                "cleaned_dirs": 0,
                "message": "Artifacts directory does not exist",
            }
        
        cutoff_time = datetime.now() - timedelta(days=7)
        cleaned_count = 0
        
        # Iterate through run directories
        for run_id in os.listdir(artifacts_dir):
            run_path = os.path.join(artifacts_dir, run_id)
            
            if not os.path.isdir(run_path):
                continue
            
            # Get directory modification time
            try:
                mod_time = datetime.fromtimestamp(os.path.getmtime(run_path))
                
                if mod_time < cutoff_time:
                    shutil.rmtree(run_path)
                    cleaned_count += 1
                    logger.info(f"Cleaned up artifacts for run {run_id}")
            except Exception as e:
                logger.warning(f"Failed to cleanup {run_path}: {e}")
        
        return {
            "status": "success",
            "cleaned_dirs": cleaned_count,
            "message": f"Cleaned up {cleaned_count} artifact directories",
        }
        
    except Exception as e:
        logger.error(f"Cleanup task failed: {e}")
        return {
            "status": "failed",
            "error": str(e),
        }


@celery_app.task(
    name="app.workers.tasks.schedule_periodic_run",
    bind=True,
)
def schedule_periodic_run_task(
    self,
    suite_id: str,
    branch: str = "main",
) -> dict:
    """
    Celery task to create and schedule a periodic test run.
    
    Args:
        self: Celery task self
        suite_id: UUID of test suite
        branch: Git branch to test
        
    Returns:
        Dictionary with result
    """
    try:
        async def create_and_run():
            async with AsyncSessionLocal() as db:
                from app.models.models import RunStatus, TestRun, TestSuite
                
                suite_uuid = uuid.UUID(suite_id)
                suite = await db.get(TestSuite, suite_uuid)
                
                if not suite:
                    raise ValueError(f"Suite {suite_id} not found")
                
                # Create new test run
                run = TestRun(
                    id=uuid.uuid4(),
                    suite_id=suite_uuid,
                    status=RunStatus.pending,
                    branch=branch,
                    triggered_by="scheduler",
                )
                db.add(run)
                await db.flush()
                
                # Schedule execution task
                execute_test_run_task.delay(
                    str(run.id),
                    str(suite.id),
                    str(suite.project_id),
                    branch,
                )
                
                return str(run.id)
        
        run_id = asyncio.run(create_and_run())
        
        return {
            "status": "scheduled",
            "run_id": run_id,
            "message": f"Test run {run_id} scheduled for execution",
        }
        
    except Exception as e:
        logger.error(f"Failed to schedule periodic run: {e}")
        return {
            "status": "failed",
            "error": str(e),
        }
