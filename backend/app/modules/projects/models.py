"""Projects, their test runs and imported Allure reports."""
from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Project(Base):
    """A test automation project (GitHub repository and/or local checkout)."""
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    key: Mapped[str] = mapped_column(String(20), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)

    # Multi-tenant fields
    community_id: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    organization_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)

    # Project settings
    lead_user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))
    icon: Mapped[Optional[str]] = mapped_column(String(100))
    color: Mapped[Optional[str]] = mapped_column(String(20))
    is_active: Mapped[Optional[bool]] = mapped_column(Boolean, default=True)
    is_archived: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    github_repo_url: Mapped[Optional[str]] = mapped_column(String(512))
    # Where the project's stories and requirement pages live (Work area).
    jira_project_key: Mapped[Optional[str]] = mapped_column(String(50))
    confluence_space_key: Mapped[Optional[str]] = mapped_column(String(100))
    # Test report pages are published under this Confluence page (phase 10).
    confluence_parent_page_id: Mapped[Optional[str]] = mapped_column(String(64))
    # Deployments and their checks are posted to this Microsoft Teams channel (workflow webhook URL, encrypted).
    teams_webhook: Mapped[Optional[str]] = mapped_column(String(1024))
    # Phase 18: the project's ATM service account for scheduled runs (a GitHub token, encrypted) and its checkout's
    # last sync. Set by a lead; schedules then no longer depend on the person who set them.
    service_github_token: Mapped[Optional[str]] = mapped_column(String(1024))
    service_configured_by_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"))
    service_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    service_error: Mapped[Optional[str]] = mapped_column(String(500))

    # Timestamps
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by_user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"))

    # Relationships
    lead = relationship("User", foreign_keys=[lead_user_id])
    creator = relationship("User", foreign_keys=[created_by_user_id])


class AllureReport(Base):
    """Normalized Allure result bundle imported from a local checkout or GitHub artifact."""
    __tablename__ = "allure_reports"
    __table_args__ = (UniqueConstraint("project_id", "source", "external_id", name="uq_allure_report_source"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(30), nullable=False)
    external_id: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    branch: Mapped[Optional[str]] = mapped_column(String(255))
    workflow_name: Mapped[Optional[str]] = mapped_column(String(255))
    report_url: Mapped[Optional[str]] = mapped_column(String(1024))
    total_tests: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    passed_tests: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    failed_tests: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    broken_tests: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    skipped_tests: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    results_json: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    imported_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow,
                                                  nullable=False)


class AnalyticsSuite(Base):
    """A project's suite: what to run (test type, framework target), where (environment) and when (schedule)."""
    __tablename__ = "analytics_suites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    tags: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    cron_expression: Mapped[Optional[str]] = mapped_column(String(100))
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    created_by_user_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    # What the suite runs (phase 08): its test type, the framework target from the checkout, the environment,
    # an optional GitHub Actions workflow, and who the schedule runs as.
    test_type: Mapped[str] = mapped_column(String(20), default="functional", server_default="functional",
                                           nullable=False)
    target: Mapped[Optional[str]] = mapped_column(String(512))
    environment_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("test_environments.id", ondelete="SET NULL"), nullable=True)
    ci_workflow: Mapped[Optional[str]] = mapped_column(String(255))
    schedule_user_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    last_scheduled_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    # Phase 17: archived suites keep their runs and reports, leave the lists and schedules, and can be restored.
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    archived_by_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    # Phase 19: publish every finished run's report to Confluence, with the token of the person who switched it on
    # (and links back to ATM as they saw it).
    auto_publish_by_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    auto_publish_origin: Mapped[Optional[str]] = mapped_column(String(255))


class AnalyticsRun(Base):
    """A local run of a suite (or of a single target): status, counts, logs, results and execution details."""
    __tablename__ = "analytics_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    suite_id: Mapped[int] = mapped_column(Integer, ForeignKey("analytics_suites.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(30), default="pending", nullable=False)
    branch: Mapped[Optional[str]] = mapped_column(String(255))
    commit_sha: Mapped[Optional[str]] = mapped_column(String(40))
    triggered_by: Mapped[Optional[str]] = mapped_column(String(255))
    name: Mapped[Optional[str]] = mapped_column(String(255))
    collection: Mapped[Optional[str]] = mapped_column(String(255))
    collection_path: Mapped[Optional[str]] = mapped_column(String(512))
    environment: Mapped[Optional[str]] = mapped_column(String(255))
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    total_tests: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    passed_tests: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    failed_tests: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    skipped_tests: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    logs_json: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    results_json: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    details_json: Mapped[Optional[dict]] = mapped_column(JSON)  # app version, device, technology, reports, performance
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    environment_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("test_environments.id", ondelete="SET NULL"), nullable=True)
    trigger: Mapped[str] = mapped_column(String(20), default="manual", server_default="manual",
                                         nullable=False)  # manual | schedule | deployment
    # Who started it (for a schedule or a deployment check: the person it runs as). Told when it finishes.
    started_by_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"))


class ReportPublication(Base):
    """A run's report published to Confluence: the page, its version, and whether it worked."""
    __tablename__ = "report_publications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    run_id: Mapped[int] = mapped_column(Integer, ForeignKey("analytics_runs.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(20))  # published | failed
    page_id: Mapped[Optional[str]] = mapped_column(String(64))
    page_url: Mapped[Optional[str]] = mapped_column(String(1024))
    page_version: Mapped[Optional[int]] = mapped_column(Integer)
    attachment: Mapped[Optional[str]] = mapped_column(String(255))
    error: Mapped[Optional[str]] = mapped_column(String(1000))
    published_by_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    published_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class ReportShareLink(Base):
    """A link to a run's report that does not expire (phase 19); revoked only by leads and super admins."""
    __tablename__ = "report_share_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    run_id: Mapped[int] = mapped_column(Integer, ForeignKey("analytics_runs.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    created_by_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    views: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_viewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime)


class TestEnvironment(Base):
    """A project's environment: variables handed to the runner (BASE_URL, …) and an optional Bruno environment."""
    __tablename__ = "test_environments"
    __test__ = False  # not a pytest test class
    __table_args__ = (UniqueConstraint("project_id", "name", name="uq_test_environment_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False,
                                            index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    variables: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    bruno_environment: Mapped[Optional[str]] = mapped_column(String(100))
    # Phase 17: secret variables, a JSON object encrypted with app.core.crypto; never sent back to the browser.
    secrets: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class ProjectMember(Base):
    """A user assigned to a project (project_base users and viewers see only these projects)."""
    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_project_member"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    added_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    added_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class BranchOwner(Base):
    """Who started a branch in ATM; trainees may push only their own branches."""
    __tablename__ = "branch_owners"
    __table_args__ = (UniqueConstraint("project_id", "branch", name="uq_branch_owner"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    branch: Mapped[str] = mapped_column(String(255))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
