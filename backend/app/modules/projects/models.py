"""Projects, their test runs and imported Allure reports."""
from datetime import datetime

from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.db import Base


class Project(Base):
    """A test automation project (GitHub repository and/or local checkout)."""
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
