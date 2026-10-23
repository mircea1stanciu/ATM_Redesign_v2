import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.session import Base


def now_utc():
    return datetime.now(timezone.utc)


class UserRole(str, enum.Enum):
    admin = "admin"
    automation_lead = "automation_lead"
    automation_user = "automation_user"
    developer = "developer"
    viewer = "viewer"


class RunStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    passed = "passed"
    failed = "failed"
    error = "error"
    cancelled = "cancelled"


class TestStatus(str, enum.Enum):
    passed = "passed"
    failed = "failed"
    skipped = "skipped"
    error = "error"


class GitProvider(str, enum.Enum):
    github = "github"
    gitlab = "gitlab"
    bitbucket = "bitbucket"


# ---------------------------------------------------------------------------
class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255))
    role = Column(Enum(UserRole), default=UserRole.viewer, nullable=False)
    assigned_lead_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    settings_json = Column(JSON, default=dict, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=now_utc)


# ---------------------------------------------------------------------------
class Project(Base):
    __tablename__ = "projects"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    git_repo_url = Column(String(512), nullable=False)
    git_provider = Column(Enum(GitProvider), default=GitProvider.github)
    default_branch = Column(String(255), default="main")
    framework = Column(String(100))          # pytest / playwright / appium / cypress / robot / bruno
    config_json = Column(JSON, default=dict) # configurare specifică framework
    created_at = Column(DateTime(timezone=True), default=now_utc)

    suites = relationship("TestSuite", back_populates="project", cascade="all, delete-orphan")


# ---------------------------------------------------------------------------
class TestSuite(Base):
    __tablename__ = "test_suites"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    name = Column(String(255), nullable=False)
    tags = Column(JSON, default=list)
    cron_expression = Column(String(100))    # null = fără scheduler
    active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=now_utc)

    project = relationship("Project", back_populates="suites")
    runs = relationship("TestRun", back_populates="suite", cascade="all, delete-orphan")


# ---------------------------------------------------------------------------
class TestRun(Base):
    __tablename__ = "test_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    suite_id = Column(UUID(as_uuid=True), ForeignKey("test_suites.id"), nullable=False)
    status = Column(Enum(RunStatus), default=RunStatus.pending, nullable=False)
    branch = Column(String(255))
    commit_sha = Column(String(40))
    triggered_by = Column(String(255))       # user email / scheduler / webhook
    source = Column(String(30), default="local", nullable=False)  # local | github_actions
    collection = Column(String(255))         # collection/suite name the run executed
    external_id = Column(String(100), index=True)  # e.g. GitHub Actions run id (for dedup on sync)
    started_at = Column(DateTime(timezone=True))
    finished_at = Column(DateTime(timezone=True))
    total_tests = Column(Integer, default=0)
    passed_tests = Column(Integer, default=0)
    failed_tests = Column(Integer, default=0)
    skipped_tests = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), default=now_utc)

    suite = relationship("TestSuite", back_populates="runs")
    results = relationship("TestResult", back_populates="run", cascade="all, delete-orphan")
    artifacts = relationship("Artifact", back_populates="run", cascade="all, delete-orphan")


# ---------------------------------------------------------------------------
class TestResult(Base):
    __tablename__ = "test_results"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id = Column(UUID(as_uuid=True), ForeignKey("test_runs.id"), nullable=False)
    test_name = Column(String(512), nullable=False)
    class_name = Column(String(512))
    status = Column(Enum(TestStatus), nullable=False)
    duration_ms = Column(Float)
    error_message = Column(Text)
    stack_trace = Column(Text)

    run = relationship("TestRun", back_populates="results")


# ---------------------------------------------------------------------------
class Artifact(Base):
    __tablename__ = "artifacts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id = Column(UUID(as_uuid=True), ForeignKey("test_runs.id"), nullable=False)
    file_path = Column(String(1024), nullable=False)
    file_type = Column(String(50))  # log / html / xml
    created_at = Column(DateTime(timezone=True), default=now_utc)

    run = relationship("TestRun", back_populates="artifacts")


class TaskStatus(str, enum.Enum):
    todo = "todo"
    in_progress = "in_progress"
    done = "done"


# ---------------------------------------------------------------------------
class Task(Base):
    """Lightweight, team-scoped task tracker used by the 'Task Management' page.

    Note: `users.id` in this application is an Integer primary key (see
    core/database.py), so assignee/creator references use Integer, not UUID.
    """
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    team_name = Column(String(255), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text)
    status = Column(Enum(TaskStatus), default=TaskStatus.todo, nullable=False)
    assignee_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=now_utc)
    updated_at = Column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


# ---------------------------------------------------------------------------
class DataExport(Base):
    __tablename__ = "data_exports"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    export_type = Column(String(50), nullable=False, default="full")
    format = Column(String(20), nullable=False, default="json")
    status = Column(String(30), nullable=False, default="pending")
    file_url = Column(String(500), nullable=True)
    file_size = Column(Integer, nullable=True)
    requested_at = Column(DateTime(timezone=True), default=now_utc)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)


class Integration(Base):
    __tablename__ = "integrations"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    service = Column(String(100), nullable=False)
    status = Column(String(30), nullable=False, default="connected")
    oauth_token = Column(Text, nullable=True)
    workspace_id = Column(String(255), nullable=True)
    connected_at = Column(DateTime(timezone=True), default=now_utc)
    last_sync = Column(DateTime(timezone=True), nullable=True)


class Webhook(Base):
    __tablename__ = "webhooks"
    id = Column(Integer, primary_key=True, autoincrement=True)
    integration_id = Column(Integer, ForeignKey("integrations.id", ondelete="CASCADE"), nullable=False)
    event_type = Column(String(100), nullable=False)
    target_url = Column(String(500), nullable=False)
    hmac_secret = Column(String(255), nullable=True)
    status = Column(String(30), nullable=False, default="active")
    delivery_count = Column(Integer, default=0)
    failure_count = Column(Integer, default=0)
    last_delivery = Column(DateTime(timezone=True), nullable=True)


class UserSubscription(Base):
    __tablename__ = "user_subscriptions"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    plan = Column(String(50), nullable=False, default="free")
    status = Column(String(30), nullable=False, default="active")
    price = Column(Integer, default=0)
    billing_cycle = Column(String(20), default="monthly")
    trial_end = Column(DateTime(timezone=True), nullable=True)
    renewal_date = Column(DateTime(timezone=True), nullable=True)
    storage_gb = Column(Integer, default=5)
    team_members = Column(Integer, default=3)
    api_rate_limit = Column(Integer, default=100)
    updated_at = Column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class BillingInvoice(Base):
    __tablename__ = "billing_invoices"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    invoice_number = Column(String(100), nullable=True)
    amount = Column(Integer, default=0)
    status = Column(String(30), nullable=False, default="pending")
    description = Column(String(500), nullable=True)
    due_date = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=now_utc)


class PaymentMethod(Base):
    __tablename__ = "payment_methods"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    payment_type = Column(String(50), nullable=False)
    masked_data = Column(String(255), nullable=True)
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=now_utc)
