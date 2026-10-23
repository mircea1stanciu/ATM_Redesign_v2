import uuid
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import TestSuite
from app.schemas.test_suites import TestSuiteCreate, TestSuiteUpdate


class TestSuiteService:
    @staticmethod
    async def create_suite(db: AsyncSession, project_id: str, suite_data: TestSuiteCreate) -> TestSuite:
        """Create a new test suite."""
        suite = TestSuite(
            id=uuid.uuid4(),
            project_id=uuid.UUID(str(project_id)),
            name=suite_data.name,
            tags=suite_data.tags or [],
            cron_expression=suite_data.cron_expression,
            active=suite_data.active,
        )
        db.add(suite)
        await db.commit()
        await db.refresh(suite)
        return suite

    @staticmethod
    async def get_suite(db: AsyncSession, suite_id: str) -> Optional[TestSuite]:
        """Get test suite by ID."""
        try:
            suite_uuid = uuid.UUID(str(suite_id))
        except (ValueError, AttributeError, TypeError):
            return None
        stmt = select(TestSuite).where(TestSuite.id == suite_uuid)
        result = await db.execute(stmt)
        return result.scalars().first()

    @staticmethod
    async def list_suites_by_project(
        db: AsyncSession, project_id: str, skip: int = 0, limit: int = 100
    ) -> list[TestSuite]:
        """List all test suites for a project."""
        try:
            project_uuid = uuid.UUID(str(project_id))
        except (ValueError, AttributeError, TypeError):
            return []
        stmt = select(TestSuite).where(TestSuite.project_id == project_uuid).offset(skip).limit(limit)
        result = await db.execute(stmt)
        return result.scalars().all()

    @staticmethod
    async def update_suite(db: AsyncSession, suite_id: str, suite_data: TestSuiteUpdate) -> Optional[TestSuite]:
        """Update a test suite."""
        suite = await TestSuiteService.get_suite(db, suite_id)
        if not suite:
            return None
        
        update_data = suite_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            if value is not None:
                setattr(suite, field, value)
        
        await db.commit()
        await db.refresh(suite)
        return suite

    @staticmethod
    async def delete_suite(db: AsyncSession, suite_id: str) -> bool:
        """Delete a test suite."""
        suite = await TestSuiteService.get_suite(db, suite_id)
        if not suite:
            return False
        
        await db.delete(suite)
        await db.commit()
        return True
