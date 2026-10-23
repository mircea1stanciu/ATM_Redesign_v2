from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class TestRunCreate(BaseModel):
    suite_id: str
    branch: Optional[str] = None
    commit_sha: Optional[str] = None
    triggered_by: Optional[str] = None
    collection: Optional[str] = None


class ExecuteRunRequest(BaseModel):
    run_project: Optional[str] = None
    run_collection: Optional[str] = None
    run_environment: Optional[str] = None


class TestRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    suite_id: UUID
    status: str
    branch: Optional[str] = None
    commit_sha: Optional[str] = None
    triggered_by: Optional[str] = None
    source: str = "local"
    collection: Optional[str] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    total_tests: int
    passed_tests: int
    failed_tests: int
    skipped_tests: int
    created_at: datetime


class TestResultResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    run_id: UUID
    test_name: str
    class_name: Optional[str] = None
    status: str
    duration_ms: Optional[float] = None
    error_message: Optional[str] = None
    stack_trace: Optional[str] = None


class TestRunDetailsResponse(TestRunResponse):
    results: list[TestResultResponse] = []
