from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Task, TaskStatus
from app.schemas.tasks import TaskResponse
from core.database import User as CoreUser

VALID_STATUSES = {s.value for s in TaskStatus}


class TaskService:
    @staticmethod
    async def _user_names(db: AsyncSession, user_ids: list[int]) -> dict:
        ids = [uid for uid in set(user_ids) if uid is not None]
        if not ids:
            return {}
        stmt = select(CoreUser.id, CoreUser.full_name, CoreUser.email).where(CoreUser.id.in_(ids))
        result = await db.execute(stmt)
        names = {}
        for row_id, full_name, email in result.all():
            names[row_id] = full_name or email
        return names

    @staticmethod
    async def _to_response(db: AsyncSession, task: Task) -> TaskResponse:
        names = await TaskService._user_names(db, [task.assignee_id, task.created_by_id])
        return TaskResponse(
            id=str(task.id),
            team_name=task.team_name,
            title=task.title,
            description=task.description,
            status=task.status.value if hasattr(task.status, "value") else str(task.status),
            assignee_id=str(task.assignee_id) if task.assignee_id is not None else None,
            assignee_name=names.get(task.assignee_id),
            created_by_id=str(task.created_by_id) if task.created_by_id is not None else None,
            created_by_name=names.get(task.created_by_id),
            created_at=task.created_at,
            updated_at=task.updated_at,
        )

    @staticmethod
    async def list_tasks(db: AsyncSession, team_name: str) -> list[TaskResponse]:
        stmt = select(Task).where(Task.team_name == team_name).order_by(Task.created_at.desc())
        result = await db.execute(stmt)
        tasks = result.scalars().all()
        return [await TaskService._to_response(db, t) for t in tasks]

    @staticmethod
    async def get_task(db: AsyncSession, task_id: int) -> Optional[Task]:
        stmt = select(Task).where(Task.id == task_id)
        result = await db.execute(stmt)
        return result.scalars().first()

    @staticmethod
    async def create_task(
        db: AsyncSession, team_name: str, title: str, description: Optional[str], created_by_id: int
    ) -> TaskResponse:
        task = Task(
            team_name=team_name,
            title=title,
            description=description,
            status=TaskStatus.todo,
            created_by_id=created_by_id,
        )
        db.add(task)
        await db.commit()
        await db.refresh(task)
        return await TaskService._to_response(db, task)

    @staticmethod
    async def set_assignee(db: AsyncSession, task: Task, assignee_id: Optional[int]) -> TaskResponse:
        task.assignee_id = assignee_id
        await db.commit()
        await db.refresh(task)
        return await TaskService._to_response(db, task)

    @staticmethod
    async def update_status(db: AsyncSession, task: Task, status: str) -> TaskResponse:
        task.status = TaskStatus(status)
        await db.commit()
        await db.refresh(task)
        return await TaskService._to_response(db, task)
