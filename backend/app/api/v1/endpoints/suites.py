
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user
from app.api.v1.endpoints.projects import _enforce_manage_project, _enforce_view_project
from app.db.session import get_db
from app.schemas.test_suites import TestSuiteCreate, TestSuiteResponse, TestSuiteUpdate
from app.services.project_service import ProjectService
from app.services.test_suite_service import TestSuiteService

router = APIRouter()


@router.post("/projects/{project_id}/suites", response_model=TestSuiteResponse)
async def create_suite(
    project_id: str,
    suite_data: TestSuiteCreate,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Create a new test suite for a project."""
    # Verify project exists
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found"
        )
    _enforce_manage_project(project, current_user)
    
    suite = await TestSuiteService.create_suite(db, project_id, suite_data)
    return TestSuiteResponse.model_validate(suite)


@router.get("/{suite_id}", response_model=TestSuiteResponse)
async def get_suite(
    suite_id: str,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Get a test suite by ID."""
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
    return TestSuiteResponse.model_validate(suite)


@router.get("/projects/{project_id}", response_model=list[TestSuiteResponse])
async def list_suites(
    project_id: str,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """List all test suites for a project."""
    # Verify project exists
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found"
        )
    _enforce_view_project(project, current_user)
    
    suites = await TestSuiteService.list_suites_by_project(db, project_id, skip=skip, limit=limit)
    return [TestSuiteResponse.model_validate(s) for s in suites]


@router.put("/{suite_id}", response_model=TestSuiteResponse)
async def update_suite(
    suite_id: str,
    suite_data: TestSuiteUpdate,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Update a test suite."""
    existing_suite = await TestSuiteService.get_suite(db, suite_id)
    if not existing_suite:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Test suite not found"
        )

    project = await ProjectService.get_project(db, str(existing_suite.project_id))
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found"
        )
    _enforce_manage_project(project, current_user)

    suite = await TestSuiteService.update_suite(db, suite_id, suite_data)
    if not suite:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Test suite not found"
        )
    return TestSuiteResponse.model_validate(suite)


@router.delete("/{suite_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_suite(
    suite_id: str,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Delete a test suite."""
    existing_suite = await TestSuiteService.get_suite(db, suite_id)
    if not existing_suite:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Test suite not found"
        )

    project = await ProjectService.get_project(db, str(existing_suite.project_id))
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found"
        )
    _enforce_manage_project(project, current_user)

    success = await TestSuiteService.delete_suite(db, suite_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Test suite not found"
        )
    return None

