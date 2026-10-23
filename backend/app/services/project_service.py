import uuid
from typing import Optional
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import GitProvider, Project
from app.schemas.projects import ProjectCreate, ProjectUpdate
from app.services.github_service import GitHubService


class ProjectService:
    @staticmethod
    async def create_project(db: AsyncSession, project_data: ProjectCreate) -> Project:
        """Create a new project."""
        # Validate GitHub repository if it's a GitHub project
        if project_data.git_provider == "github":
            github_service = GitHubService()
            repo_url = project_data.git_repo_url.strip()

            # Keep strict validation for github.com URLs.
            # For custom enterprise domains, allow project creation even when API probing fails,
            # because host/API shape can differ from standard GitHub endpoints.
            strict_github_host = False
            if repo_url.startswith("git@github.com:"):
                strict_github_host = True
            else:
                parsed = urlparse(repo_url)
                host = parsed.netloc.lower() if parsed.netloc else ""
                strict_github_host = host in {"github.com", "www.github.com"}

            exists = await github_service.check_repository_exists(project_data.git_repo_url)
            if strict_github_host and not exists:
                raise ValueError("GitHub repository not found or not accessible")
        
        project = Project(
            id=uuid.uuid4(),
            name=project_data.name,
            description=project_data.description,
            git_repo_url=project_data.git_repo_url,
            git_provider=GitProvider(project_data.git_provider),
            default_branch=project_data.default_branch,
            framework=project_data.framework,
            config_json=project_data.config_json or {},
        )
        db.add(project)
        await db.commit()
        await db.refresh(project)
        return project

    @staticmethod
    async def get_project(db: AsyncSession, project_id: str) -> Optional[Project]:
        """Get project by ID."""
        try:
            project_uuid = uuid.UUID(str(project_id))
        except (ValueError, AttributeError, TypeError):
            return None
        stmt = select(Project).where(Project.id == project_uuid)
        result = await db.execute(stmt)
        return result.scalars().first()

    @staticmethod
    async def list_projects(db: AsyncSession, skip: int = 0, limit: int = 100) -> list[Project]:
        """List all projects with pagination."""
        stmt = select(Project).offset(skip).limit(limit)
        result = await db.execute(stmt)
        return result.scalars().all()

    @staticmethod
    async def update_project(
        db: AsyncSession, project_id: str, project_data: ProjectUpdate
    ) -> Optional[Project]:
        """Update an existing project."""
        project = await ProjectService.get_project(db, project_id)
        if not project:
            return None
        
        update_data = project_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            if value is not None:
                setattr(project, field, value)
        
        await db.commit()
        await db.refresh(project)
        return project

    @staticmethod
    async def delete_project(db: AsyncSession, project_id: str) -> bool:
        """Delete a project."""
        project = await ProjectService.get_project(db, project_id)
        if not project:
            return False
        
        await db.delete(project)
        await db.commit()
        return True
    
    @staticmethod
    async def get_project_branches(project_id: str, db: AsyncSession) -> list[dict]:
        """Get branches for a project's GitHub repository."""
        project = await ProjectService.get_project(db, project_id)
        if not project:
            raise ValueError("Project not found")
        
        if project.git_provider.value != "github":
            raise ValueError("Only GitHub repositories are currently supported")
        
        github_service = GitHubService()
        owner, repo = github_service.parse_github_url(project.git_repo_url)
        return await github_service.get_branches(owner, repo)
    
    @staticmethod
    async def get_project_tags(project_id: str, db: AsyncSession) -> list[dict]:
        """Get tags for a project's GitHub repository."""
        project = await ProjectService.get_project(db, project_id)
        if not project:
            raise ValueError("Project not found")
        
        if project.git_provider.value != "github":
            raise ValueError("Only GitHub repositories are currently supported")
        
        github_service = GitHubService()
        owner, repo = github_service.parse_github_url(project.git_repo_url)
        return await github_service.get_tags(owner, repo)
