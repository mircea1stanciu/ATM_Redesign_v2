"""Learning: progress, learner profiles, practice tasks and submissions, and the hint library (phase 13).

Revision ID: 0010_learning
"""
from datetime import datetime

import sqlalchemy as sa

from alembic import op

revision = "0010_learning"
down_revision = "0009_pull_request_reviews"
branch_labels = None
depends_on = None

UI = ["playwright", "cypress", "selenium", "webdriverio", "appium"]
# The workspace's standard hints (frontend src/features/workspace/hints.ts detects them) and a few general ones.
HINTS = [
    ("no-assertion", "Every test needs an assertion",
     "This test has no assertion yet. Add expect(…) (or an assert block in Bruno) so it can fail when the feature "
     "breaks.",
     "A test without an assertion only checks that nothing crashed. Decide what the user should see or what the API "
     "should answer, and assert exactly that: a status code, a message, a value. One clear assertion per behaviour "
     "makes the failure message say what broke.", []),
    ("only", "Remove .only before you commit",
     ".only runs just this test and skips the others in CI. Remove it before you commit.",
     "test.only and describe.only are handy while you write a test, but committed they silently skip the rest of the "
     "suite in CI, so failures go unnoticed.", ["playwright", "cypress", "webdriverio", "javascript"]),
    ("fixed-wait", "Wait for a condition, not for time",
     "A fixed wait makes the test slow and flaky. Wait for a condition instead: an element, a URL or a response.",
     "Fixed sleeps are either too short on a slow machine (the test fails) or too long everywhere else (the suite "
     "crawls). Every framework can wait for a condition: an element to be visible, a URL, a network response.",
     [*UI, "java", "python", "javascript"]),
    ("hard-coded-secret", "Keep secrets out of the code",
     "This looks like a hard-coded password or token. Read it from an environment variable or a Bruno environment.",
     "Anything committed to Git is visible to everyone with access to the repository, forever. Read passwords and "
     "tokens from environment variables, a secret store or a Bruno environment that is not committed.", []),
    ("brittle-selector", "Use stable selectors",
     "Prefer stable selectors (data-testid, role, label text) over absolute XPath or nth-child: layout changes break "
     "them.",
     "Selectors that follow the page layout break whenever a designer moves a div. Ask developers for data-testid "
     "attributes, or select by role and accessible name as a user would.", UI),
    ("one-behaviour", "One behaviour per test",
     "Keep one behaviour per test: when it fails, its name says what broke.",
     "Long tests that check many things stop at the first failure and hide the rest. Small tests named after the "
     "behaviour they check make reports readable.", []),
    ("acceptance-criteria", "Start from the acceptance criteria",
     "Start from the acceptance criteria of the story: one test per criterion is a good first step.",
     "The acceptance criteria are the agreed definition of done. Turning each one into a test gives the story clear "
     "coverage and gives reviewers something concrete to check.", []),
    ("run-changed", "Run what you changed before you commit",
     "Run the tests you changed (Run changed tests) before you commit.",
     "A test that was never run green may never have worked. The workspace's Run changed tests runs only the files you "
     "touched, so it is quick.", []),
    ("bruno-environments", "Put base URLs in environments",
     "Use {{baseUrl}} from a Bruno environment instead of writing the host in every request.",
     "Environments let the same collection run against test, UAT and production-like systems. Keep secrets in a "
     "local, uncommitted environment file.", ["bruno", "postman"]),
    ("k6-thresholds", "Fail the run with thresholds",
     "Add thresholds (for example p(95)<500) so a slow build fails the run instead of only printing numbers.",
     "Without thresholds a k6 run always passes. Thresholds turn your performance goals into pass or fail.", ["k6"]),
]


def upgrade() -> None:
    op.create_table(
        "learning_progress",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("item_id", sa.String(100), nullable=False),
        sa.Column("best_score", sa.Integer(), nullable=True),
        sa.Column("total", sa.Integer(), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("passed", sa.Boolean(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "kind", "item_id", name="uq_learning_progress_item"),
    )
    op.create_index("ix_learning_progress_user_id", "learning_progress", ["user_id"])
    op.create_table(
        "learning_profiles",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("path_id", sa.String(100), nullable=True),
        sa.Column("tutor_mode", sa.Boolean(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_table(
        "practice_tasks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("path_id", sa.String(100), nullable=True),
        sa.Column("project_id", sa.Integer(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "practice_submissions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("task_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("branch", sa.String(255), nullable=True),
        sa.Column("link", sa.String(1024), nullable=True),
        sa.Column("note", sa.String(2000), nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("feedback", sa.String(4000), nullable=True),
        sa.Column("reviewer_id", sa.Integer(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["task_id"], ["practice_tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reviewer_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("task_id", "user_id", name="uq_practice_submission"),
    )
    op.create_index("ix_practice_submissions_task_id", "practice_submissions", ["task_id"])
    op.create_index("ix_practice_submissions_user_id", "practice_submissions", ["user_id"])
    hints = op.create_table(
        "hints",
        sa.Column("id", sa.String(64), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("text", sa.String(500), nullable=False),
        sa.Column("details", sa.Text(), nullable=False),
        sa.Column("topics", sa.JSON(), nullable=False),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    now = datetime.utcnow()
    op.bulk_insert(hints, [{"id": i, "title": t, "text": x, "details": d, "topics": topics, "updated_at": now}
                           for i, t, x, d, topics in HINTS])


def downgrade() -> None:
    op.drop_table("hints")
    op.drop_table("practice_submissions")
    op.drop_table("practice_tasks")
    op.drop_table("learning_profiles")
    op.drop_table("learning_progress")
