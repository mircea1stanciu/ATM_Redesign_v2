
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user
from app.api.v1.endpoints.projects import _enforce_view_project
from app.db.session import get_db
from app.services.project_service import ProjectService
from app.services.test_suite_service import TestSuiteService

router = APIRouter()


class PassRateStats(BaseModel):
    total_runs: int
    passed_runs: int
    failed_runs: int
    pass_rate: float


class TestStats(BaseModel):
    total_tests: int
    passed_tests: int
    failed_tests: int
    skipped_tests: int


@router.get("/projects/{project_id}/stats", response_model=PassRateStats)
async def get_project_stats(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Get pass rate statistics for a project."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found"
        )
    _enforce_view_project(project, current_user)

    # TODO Faza 4: Implement statistics collection
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Statistics endpoint not implemented yet"
    )


@router.get("/suites/{suite_id}/stats", response_model=PassRateStats)
async def get_suite_stats(
    suite_id: str,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Get pass rate statistics for a test suite."""
    suite = await TestSuiteService.get_suite(db, suite_id)
    if not suite:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Test suite not found"
        )

    project = await ProjectService.get_project(db, str(suite.project_id))
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found"
        )
    _enforce_view_project(project, current_user)

    # TODO Faza 4: Implement statistics collection
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Statistics endpoint not implemented yet"
    )

