import logging

from celery import Celery, Task
from celery.schedules import crontab

from app.core.config import settings

# Configure logging
logger = logging.getLogger(__name__)

# Create Celery app
celery_app = Celery(
    "testmanager",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
)

# Celery configuration
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=30 * 60,  # 30 minutes hard limit
    task_soft_time_limit=25 * 60,  # 25 minutes soft limit
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=1000,
    result_expires=3600,  # Results expire after 1 hour
)

# Periodic tasks
celery_app.conf.beat_schedule = {
    # Example: Run cleanup every hour
    "cleanup-old-artifacts": {
        "task": "app.workers.tasks.cleanup_old_artifacts",
        "schedule": crontab(minute=0),  # Every hour
    },
}


class CallbackTask(Task):
    """Task with callbacks for monitoring."""
    
    def on_success(self, retval, task_id, args, kwargs):
        """Success handler."""
        logger.info(f"Task {task_id} succeeded")
    
    def on_failure(self, exc, task_id, args, kwargs, einfo):
        """Failure handler."""
        logger.error(f"Task {task_id} failed: {exc}")
    
    def on_retry(self, exc, task_id, args, kwargs, einfo):
        """Retry handler."""
        logger.warning(f"Task {task_id} retrying: {exc}")


# Set default task class
celery_app.Task = CallbackTask
