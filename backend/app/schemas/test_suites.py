from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class TestSuiteCreate(BaseModel):
    name: str
    tags: Optional[list[str]] = None
    cron_expression: Optional[str] = None
    active: bool = True


class TestSuiteUpdate(BaseModel):
    name: Optional[str] = None
    tags: Optional[list[str]] = None
    cron_expression: Optional[str] = None
    active: Optional[bool] = None


class TestSuiteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    project_id: UUID
    name: str
    tags: Optional[list[str]] = None
    cron_expression: Optional[str] = None
    active: bool
    created_at: datetime
