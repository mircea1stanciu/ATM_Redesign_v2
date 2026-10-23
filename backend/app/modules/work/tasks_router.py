from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user
from app.modules.settings.connections import store_settings
from app.modules.work.schemas import (
    TaskCreate,
    TaskResponse,
    TaskStatusUpdate,
    TeamSettingsResponse,
    TeamSettingsUpdate,
)
from app.modules.work.tasks_service import VALID_STATUSES, TaskService

router = APIRouter()


def _user_settings(user) -> dict:
    return dict(getattr(user, "settings_json", {}) or {})


@router.get("/team-settings", response_model=TeamSettingsResponse)
async def get_team_settings(current_user=Depends(get_current_user)):
    """Return the team the current user has configured for Task Management."""
    data = _user_settings(current_user)
    return TeamSettingsResponse(team_name=data.get("task_team_name") or None)


@router.put("/team-settings", response_model=TeamSettingsResponse)
async def set_team_settings(
    payload: TeamSettingsUpdate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Save the team the current user belongs to."""
    data = _user_settings(current_user)
    team_name = (payload.team_name or "").strip()
    data["task_team_name"] = team_name or None
    store_settings(current_user, data)
    db.commit()
    db.refresh(current_user)
    return TeamSettingsResponse(team_name=data.get("task_team_name"))


def _current_team(current_user) -> str:
    data = _user_settings(current_user)
    team_name = data.get("task_team_name")
    if not team_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No team configured. Set your team in Task Management first.",
        )
    return team_name


@router.get("", response_model=list[TaskResponse])
async def list_tasks(
    team_name: str | None = None,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List tasks for a team (defaults to the current user's configured team)."""
    team = (team_name or "").strip() or _current_team(current_user)
    return await TaskService.list_tasks(db, team)


@router.post("", response_model=TaskResponse)
async def create_task(
    payload: TaskCreate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a new task in the selected (or current user's) team."""
    team = (payload.team_name or "").strip() or _current_team(current_user)
    if not payload.title.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Title is required")
    return await TaskService.create_task(
        db, team, payload.title.strip(), payload.description, int(current_user.id)
    )


async def _get_task_or_404(db: Session, task_id: int):
    task = await TaskService.get_task(db, task_id)
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


@router.post("/{task_id}/assign-to-me", response_model=TaskResponse)
async def assign_task_to_me(
    task_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Assign a task to the current user."""
    task = await _get_task_or_404(db, task_id)
    return await TaskService.set_assignee(db, task, int(current_user.id))


@router.post("/{task_id}/unassign", response_model=TaskResponse)
async def unassign_task(
    task_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove the current assignee from a task."""
    task = await _get_task_or_404(db, task_id)
    return await TaskService.set_assignee(db, task, None)


@router.patch("/{task_id}/status", response_model=TaskResponse)
async def update_task_status(
    task_id: int,
    payload: TaskStatusUpdate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update a task's progress status (todo / in_progress / done)."""
    if payload.status not in VALID_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid status: {payload.status}")
    task = await _get_task_or_404(db, task_id)
    return await TaskService.update_status(db, task, payload.status)
