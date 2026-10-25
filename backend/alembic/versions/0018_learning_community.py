"""Learning paths in the database (seeded with the eight of phase 13) and mentors assigned by leads (phase 21).

Revision ID: 0018_learning_community
"""
from datetime import datetime

import sqlalchemy as sa

from alembic import op

revision = "0018_learning_community"
down_revision = "0017_reviews_notifications"
branch_labels = None
depends_on = None

PATHS = [
    ("api-bruno", "Manual to API automation with Bruno", ["bruno", "postman"],
     "From requests you try by hand to Git-tracked API suites that run in CI."),
    ("ui-playwright", "UI automation with Playwright", ["javascript", "playwright"],
     "JavaScript for testers, then reliable browser tests with Playwright."),
    ("java-automation", "Java automation: Selenium, JUnit 5 and REST Assured", ["java", "junit5", "selenium",
                                                                               "restassured"],
     "Java for testers, a test framework, browser automation and API checks in one stack."),
    ("mobile-appium", "Mobile automation with Appium", ["java", "appium"],
     "Automate Android and iOS apps with Appium and Java."),
    ("python-automation", "Python test automation", ["python", "robotframework"],
     "pytest and Python for testers, then keyword-driven suites with Robot Framework."),
    ("js-ui-frameworks", "JavaScript UI testing: Cypress and WebdriverIO", ["javascript", "cypress", "webdriverio"],
     "Two more JavaScript frameworks for web UI tests, and when to choose which."),
    ("api-bdd-karate", "API testing in BDD style with Karate", ["karate"],
     "Readable API scenarios with Karate, no Java coding needed."),
    ("performance-k6", "Performance testing with k6", ["javascript", "k6"],
     "Load and stress tests written in JavaScript, with thresholds that fail a slow build."),
]


def upgrade() -> None:
    paths = op.create_table(
        "learning_paths",
        sa.Column("id", sa.String(100), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.String(1000), nullable=False),
        sa.Column("programs", sa.JSON(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    now = datetime.utcnow()
    op.bulk_insert(paths, [{"id": pid, "title": title, "description": description, "programs": programs,
                            "position": index, "updated_by_id": None, "updated_at": now}
                           for index, (pid, title, programs, description) in enumerate(PATHS)])
    with op.batch_alter_table("learning_profiles") as batch:
        batch.add_column(sa.Column("mentor_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_learning_profiles_mentor_id", "users", ["mentor_id"], ["id"], ondelete="SET NULL")
        batch.create_index("ix_learning_profiles_mentor_id", ["mentor_id"])


def downgrade() -> None:
    with op.batch_alter_table("learning_profiles") as batch:
        batch.drop_index("ix_learning_profiles_mentor_id")
        batch.drop_constraint("fk_learning_profiles_mentor_id", type_="foreignkey")
        batch.drop_column("mentor_id")
    op.drop_table("learning_paths")
