"""
Project Management Models for Jira-like functionality
"""
import enum
from datetime import datetime

from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.orm import relationship

from core.database import Base


class IssueType(enum.Enum):
    """Issue/Task types"""
    STORY = "story"
    TASK = "task"
    BUG = "bug"
    EPIC = "epic"


class IssuePriority(enum.Enum):
    """Issue priority levels"""
    LOWEST = "lowest"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    HIGHEST = "highest"


class IssueStatus(enum.Enum):
    """Issue workflow status"""
    BACKLOG = "backlog"
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    IN_REVIEW = "in_review"
    DONE = "done"
    CLOSED = "closed"


class Project(Base):
    """Project - Container for issues (like Jira Project)"""
    __tablename__ = "projects"
    
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(20), unique=True, nullable=False, index=True)
    name = Column(String(200), nullable=False)
    description = Column(Text)
    
    # Multi-tenant fields
    community_id = Column(String(50), nullable=False, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    
    # Project settings
    lead_user_id = Column(Integer, ForeignKey("users.id"))
    icon = Column(String(100))
    color = Column(String(20))
    is_active = Column(Boolean, default=True)
    is_archived = Column(Boolean, default=False)
    github_repo_url = Column(String(512))
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by_user_id = Column(Integer, ForeignKey("users.id"))
    
    # Relationships
    issues = relationship("Issue", back_populates="project", cascade="all, delete-orphan")
    sprints = relationship("Sprint", back_populates="project", cascade="all, delete-orphan")
    lead = relationship("User", foreign_keys=[lead_user_id])
    creator = relationship("User", foreign_keys=[created_by_user_id])


class AllureReport(Base):
    """Normalized Allure result bundle imported from a local checkout or GitHub artifact."""
    __tablename__ = "allure_reports"
    __table_args__ = (UniqueConstraint("project_id", "source", "external_id", name="uq_allure_report_source"),)

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    source = Column(String(30), nullable=False)
    external_id = Column(String(255), nullable=False)
    name = Column(String(255), nullable=False)
    branch = Column(String(255))
    workflow_name = Column(String(255))
    report_url = Column(String(1024))
    total_tests = Column(Integer, default=0, nullable=False)
    passed_tests = Column(Integer, default=0, nullable=False)
    failed_tests = Column(Integer, default=0, nullable=False)
    broken_tests = Column(Integer, default=0, nullable=False)
    skipped_tests = Column(Integer, default=0, nullable=False)
    duration_ms = Column(Integer, default=0, nullable=False)
    results_json = Column(JSON, default=list, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    imported_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class AnalyticsSuite(Base):
    """Legacy suite metadata used by the Vite Runs and Analytics views."""
    __tablename__ = "analytics_suites"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    tags = Column(JSON, default=list, nullable=False)
    cron_expression = Column(String(100))
    active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class AnalyticsRun(Base):
    """Legacy manually-created run metadata for the Vite Runs workflow."""
    __tablename__ = "analytics_runs"

    id = Column(Integer, primary_key=True, index=True)
    suite_id = Column(Integer, ForeignKey("analytics_suites.id"), nullable=False, index=True)
    status = Column(String(30), default="pending", nullable=False)
    branch = Column(String(255))
    commit_sha = Column(String(40))
    triggered_by = Column(String(255))
    name = Column(String(255))
    collection = Column(String(255))
    collection_path = Column(String(512))
    environment = Column(String(255))
    started_at = Column(DateTime)
    finished_at = Column(DateTime)
    total_tests = Column(Integer, default=0, nullable=False)
    passed_tests = Column(Integer, default=0, nullable=False)
    failed_tests = Column(Integer, default=0, nullable=False)
    skipped_tests = Column(Integer, default=0, nullable=False)
    logs_json = Column(JSON, default=list, nullable=False)
    results_json = Column(JSON, default=list, nullable=False)
    details_json = Column(JSON)  # execution details: app version, device, technology, reports
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class Issue(Base):
    """Issue/Task - Individual work item"""
    __tablename__ = "issues"
    
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(50), unique=True, nullable=False, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    
    title = Column(String(500), nullable=False)
    description = Column(Text)
    issue_type = Column(SQLEnum(IssueType), nullable=False, default=IssueType.TASK)
    priority = Column(SQLEnum(IssuePriority), nullable=False, default=IssuePriority.MEDIUM)
    status = Column(SQLEnum(IssueStatus), nullable=False, default=IssueStatus.BACKLOG)
    
    assignee_id = Column(Integer, ForeignKey("users.id"))
    reporter_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    parent_issue_id = Column(Integer, ForeignKey("issues.id"))
    epic_id = Column(Integer, ForeignKey("issues.id"))
    sprint_id = Column(Integer, ForeignKey("sprints.id"))
    
    story_points = Column(Integer)
    resolution = Column(String(100))
    due_date = Column(DateTime)
    resolved_at = Column(DateTime)
    order_index = Column(Integer, default=0)
    custom_fields = Column(JSON)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    project = relationship("Project", back_populates="issues")
    assignee = relationship("User", foreign_keys=[assignee_id])
    reporter = relationship("User", foreign_keys=[reporter_id])
    comments = relationship("IssueComment", back_populates="issue", cascade="all, delete-orphan")
    attachments = relationship("IssueAttachment", back_populates="issue", cascade="all, delete-orphan")
    activities = relationship("IssueActivity", back_populates="issue", cascade="all, delete-orphan")
    watchers = relationship("IssueWatcher", back_populates="issue", cascade="all, delete-orphan")
    parent = relationship("Issue", remote_side=[id], foreign_keys=[parent_issue_id])
    sprint = relationship("Sprint", back_populates="issues")


class Sprint(Base):
    """Sprint - Time-boxed iteration"""
    __tablename__ = "sprints"
    
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    
    name = Column(String(200), nullable=False)
    goal = Column(Text)
    start_date = Column(DateTime)
    end_date = Column(DateTime)
    
    is_active = Column(Boolean, default=False)
    is_completed = Column(Boolean, default=False)
    completed_at = Column(DateTime)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    project = relationship("Project", back_populates="sprints")
    issues = relationship("Issue", back_populates="sprint")


class IssueComment(Base):
    """Comment on an issue"""
    __tablename__ = "issue_comments"
    
    id = Column(Integer, primary_key=True, index=True)
    issue_id = Column(Integer, ForeignKey("issues.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    content = Column(Text, nullable=False)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    issue = relationship("Issue", back_populates="comments")
    user = relationship("User")


class IssueAttachment(Base):
    """File attachment on an issue"""
    __tablename__ = "issue_attachments"
    
    id = Column(Integer, primary_key=True, index=True)
    issue_id = Column(Integer, ForeignKey("issues.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    filename = Column(String(500), nullable=False)
    file_path = Column(String(1000), nullable=False)
    file_size = Column(Integer)
    mime_type = Column(String(200))
    
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    
    issue = relationship("Issue", back_populates="attachments")
    user = relationship("User")


class IssueActivity(Base):
    """Activity log for issue changes"""
    __tablename__ = "issue_activities"
    
    id = Column(Integer, primary_key=True, index=True)
    issue_id = Column(Integer, ForeignKey("issues.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    action = Column(String(100), nullable=False)
    field = Column(String(100))
    old_value = Column(Text)
    new_value = Column(Text)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    issue = relationship("Issue", back_populates="activities")
    user = relationship("User")


class IssueWatcher(Base):
    """Users watching an issue"""
    __tablename__ = "issue_watchers"
    
    id = Column(Integer, primary_key=True, index=True)
    issue_id = Column(Integer, ForeignKey("issues.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    issue = relationship("Issue", back_populates="watchers")
    user = relationship("User")
