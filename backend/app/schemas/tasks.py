from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class TeamSettingsResponse(BaseModel):
    team_name: Optional[str] = None


class TeamSettingsUpdate(BaseModel):
    team_name: Optional[str] = None


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    team_name: Optional[str] = None  # falls back to the current user's configured team


class TaskStatusUpdate(BaseModel):
    status: str  # todo / in_progress / done


class TaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    team_name: str
    title: str
    description: Optional[str] = None
    status: str
    assignee_id: Optional[str] = None
    assignee_name: Optional[str] = None
    created_by_id: Optional[str] = None
    created_by_name: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
