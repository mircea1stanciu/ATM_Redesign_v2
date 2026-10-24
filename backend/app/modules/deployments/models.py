"""Deployed components, which projects test them, their deployments and the checks run after each (phase 11)."""
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Service(Base):
    """A backend service or frontend app that CI/CD deploys. Its pipeline signs deployment webhooks with the secret."""
    __tablename__ = "services"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(20), default="backend", nullable=False)  # backend | frontend
    description: Mapped[Optional[str]] = mapped_column(String(500))
    webhook_secret: Mapped[str] = mapped_column(String(512), nullable=False)  # encrypted (app.core.crypto)
    created_by_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class ServiceProject(Base):
    """The service map: a project that tests the service, and optionally the smoke suite run after a deployment."""
    __tablename__ = "service_projects"
    __table_args__ = (UniqueConstraint("service_id", "project_id", name="uq_service_project"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    service_id: Mapped[int] = mapped_column(Integer, ForeignKey("services.id", ondelete="CASCADE"), nullable=False,
                                            index=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False,
                                            index=True)
    smoke_suite_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("analytics_suites.id", ondelete="SET NULL"))
    # The check runs as the person who chose the smoke suite, in their checkout (like a schedule).
    check_user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"))


class Deployment(Base):
    __tablename__ = "deployments"
    __table_args__ = (UniqueConstraint("service_id", "delivery_id", name="uq_deployment_delivery"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    service_id: Mapped[int] = mapped_column(Integer, ForeignKey("services.id", ondelete="CASCADE"), nullable=False,
                                            index=True)
    version: Mapped[str] = mapped_column(String(100), nullable=False)
    environment: Mapped[str] = mapped_column(String(100), nullable=False)
    source: Mapped[Optional[str]] = mapped_column(String(255))  # the pipeline that sent it
    commit_sha: Mapped[Optional[str]] = mapped_column(String(64))
    url: Mapped[Optional[str]] = mapped_column(String(1024))  # the pipeline run or release
    notes: Mapped[Optional[str]] = mapped_column(String(2000))
    delivery_id: Mapped[Optional[str]] = mapped_column(String(100))  # repeated deliveries are recorded once
    deployed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    received_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class DeploymentCheck(Base):
    """The environment check of one project after a deployment: a run of its smoke suite (open topic T2)."""
    __tablename__ = "deployment_checks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    deployment_id: Mapped[int] = mapped_column(Integer, ForeignKey("deployments.id", ondelete="CASCADE"),
                                               nullable=False, index=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    suite_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("analytics_suites.id", ondelete="SET NULL"))
    run_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("analytics_runs.id", ondelete="SET NULL"),
                                                  index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False)  # running | passed | failed | error | skipped
    detail: Mapped[Optional[str]] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
