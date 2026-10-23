from __future__ import annotations

import asyncio
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user, require_user_or_above
from app.api.v1.endpoints.projects import _enforce_view_project
from app.db.session import AsyncSessionLocal, get_db
from app.schemas.test_runs import (
    ExecuteRunRequest,
    TestRunCreate,
    TestRunDetailsResponse,
    TestRunResponse,
)
from app.services.project_service import ProjectService
from app.services.test_run_service import TestRunService
from app.services.test_suite_service import TestSuiteService
from app.services.websocket_manager import connection_manager

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("", response_model=TestRunResponse)
async def create_run(
    run_data: TestRunCreate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_user_or_above),
):
    """Create a new test run. Requires Automation User or above."""
    # Verify suite exists
    suite = await TestSuiteService.get_suite(db, str(run_data.suite_id))
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
    _enforce_view_project(project, _user)
    
    run = await TestRunService.create_run(db, run_data)
    return TestRunResponse.model_validate(run)


@router.get("/{run_id}", response_model=TestRunDetailsResponse)
async def get_run(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Get a test run by ID with details."""
    run = await TestRunService.get_run(db, run_id)
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Test run not found"
        )

    suite = await TestSuiteService.get_suite(db, str(run.suite_id))
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

    # Defensive hydration: avoid async lazy-loading during Pydantic validation
    # (MissingGreenlet) if results was not eagerly loaded upstream.
    await db.refresh(run, attribute_names=["results"])
    
    details = TestRunDetailsResponse.model_validate(run)
    return details


@router.get("/suites/{suite_id}", response_model=list[TestRunResponse])
async def list_runs_by_suite(
    suite_id: str,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """List all test runs for a test suite."""
    # Verify suite exists
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
    
    runs = await TestRunService.list_runs_by_suite(db, suite_id, skip=skip, limit=limit)
    return [TestRunResponse.model_validate(r) for r in runs]


@router.get("/projects/{project_id}", response_model=list[TestRunResponse])
async def list_runs_by_project(
    project_id: str,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """List all test runs for a project."""
    project = await ProjectService.get_project(db, project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found"
        )
    _enforce_view_project(project, current_user)

    runs = await TestRunService.list_runs_by_project(db, project_id, skip=skip, limit=limit)
    return [TestRunResponse.model_validate(r) for r in runs]


@router.post("/{run_id}/cancel", response_model=dict)
async def cancel_run(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_user_or_above),
):
    """Cancel a pending or running test run."""
    existing_run = await TestRunService.get_run(db, run_id)
    if not existing_run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Test run not found")

    suite = await TestSuiteService.get_suite(db, str(existing_run.suite_id))
    if not suite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Test suite not found")

    project = await ProjectService.get_project(db, str(suite.project_id))
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    _enforce_view_project(project, current_user)

    run = await TestRunService.cancel_run(db, run_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Test run not found")
    return {"status": "cancelled", "run_id": run_id}


@router.delete("/{run_id}", response_model=dict)
async def delete_run(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_user_or_above),
):
    """Delete a test run (cancels first if still running)."""
    existing_run = await TestRunService.get_run(db, run_id)
    if not existing_run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Test run not found")

    suite = await TestSuiteService.get_suite(db, str(existing_run.suite_id))
    if not suite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Test suite not found")

    project = await ProjectService.get_project(db, str(suite.project_id))
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    _enforce_view_project(project, current_user)

    # Cancel if active
    await TestRunService.cancel_run(db, run_id)
    deleted = await TestRunService.delete_run(db, run_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Test run not found")
    return {"status": "deleted", "run_id": run_id}


@router.post("/{run_id}/execute", response_model=dict)
async def execute_run(
    run_id: str,
    payload: ExecuteRunRequest | None = None,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """
    Execute a test run asynchronously.
    Delegates execution to Celery task queue.
    """
    # Fetch run details
    run = await TestRunService.get_run(db, run_id)
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Test run not found"
        )
    
    # Get suite and project info
    suite = await TestSuiteService.get_suite(db, str(run.suite_id))
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
    
    # Run as asyncio background task (no Celery worker required)
    run_project = payload.run_project if payload else None
    run_collection = payload.run_collection if payload else None
    run_environment = payload.run_environment if payload else None

    asyncio.create_task(_execute_run_background(
        run_id,
        str(run.suite_id),
        str(suite.project_id),
        run.branch or "main",
        run_project,
        run_collection,
        run_environment,
    ))

    return {
        "status": "scheduled",
        "run_id": run_id,
        "message": f"Test run {run_id} scheduled for execution"
    }


async def _execute_run_background(
    run_id: str,
    suite_id: str,
    project_id: str,
    branch: str,
    run_project: str | None,
    run_collection: str | None,
    run_environment: str | None,
) -> None:
    """Execute a test run in-process and broadcast logs via WebSocket."""
    try:
        await connection_manager.broadcast_log(run_id, "stdout", f"$ Starting execution for run {run_id[:8]}...")
        if run_project:
            await connection_manager.broadcast_log(run_id, "stdout", f"$ Project:     {run_project}")
        if run_collection:
            await connection_manager.broadcast_log(run_id, "stdout", f"$ Collection:  {run_collection}")
        if run_environment:
            await connection_manager.broadcast_log(run_id, "stdout", f"$ Environment: {run_environment}")
        await connection_manager.broadcast_log(run_id, "stdout", f"$ Branch:      {branch}")
        await connection_manager.broadcast_log(run_id, "stdout", "")

        async with AsyncSessionLocal() as db:
            await TestRunService.execute_test_run(
                db,
                uuid.UUID(run_id),
                uuid.UUID(suite_id),
                uuid.UUID(project_id),
                branch,
                run_project=run_project,
                run_collection=run_collection,
                run_environment=run_environment,
            )

        await connection_manager.broadcast_log(run_id, "stdout", "")
        await connection_manager.broadcast_log(run_id, "stdout", "$ Execution finished.")
        await connection_manager.broadcast_status(run_id, "completed")

    except Exception as e:
        logger.error(f"Background execution failed for run {run_id}: {e}")
        await connection_manager.broadcast_log(run_id, "stderr", f"Error: {e}")
        await connection_manager.broadcast_status(run_id, "error")


@router.websocket("/ws/{run_id}")
async def websocket_endpoint(websocket: WebSocket, run_id: str):
    """
    WebSocket endpoint for streaming test logs and updates.
    
    Clients connect to /runs/ws/{run_id} to receive real-time:
    - stdout logs
    - stderr logs
    - status updates
    - test results
    """
    await connection_manager.connect(run_id, websocket)
    
    try:
        while True:
            # Keep connection alive and handle incoming messages
            data = await websocket.receive_text()
            
            # Handle ping/pong or other client messages if needed
            if data == "ping":
                await websocket.send_text("pong")
    
    except WebSocketDisconnect:
        await connection_manager.disconnect(run_id, websocket)
        logger.info(f"Client disconnected from run {run_id}")
    
    except Exception as e:
        logger.error(f"WebSocket error for run {run_id}: {e}")
        try:
            await connection_manager.disconnect(run_id, websocket)
        except Exception:
            pass


