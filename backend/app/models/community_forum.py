"""Community Forum ORM models.

These models power the per-community discussion forum (posts, threaded
comments, attachments and reactions). They are attached to the same
declarative ``Base`` as :class:`core.database.User` so relationships to users
resolve correctly, and they live in the same SQLite database (``unifiedwork.db``).
"""
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from core.database import Base


class ForumPost(Base):
    """A discussion thread posted inside a single community."""

    __tablename__ = "forum_posts"
    __table_args__ = ({"extend_existing": True},)

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=True, index=True)
    community_id = Column(String(50), nullable=False, index=True)  # e.g. "qa", "backend"
    author_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)

    title = Column(String(300), nullable=False)
    body = Column(Text, nullable=False, default="")  # Markdown
    tags = Column(JSON, default=list)  # list[str]

    is_pinned = Column(Boolean, default=False, nullable=False)
    is_locked = Column(Boolean, default=False, nullable=False)
    is_deleted = Column(Boolean, default=False, nullable=False)
    view_count = Column(Integer, default=0, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    author = relationship("User", foreign_keys=[author_id])
    comments = relationship(
        "ForumComment",
        back_populates="post",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    attachments = relationship(
        "ForumAttachment",
        primaryjoin="ForumPost.id == foreign(ForumAttachment.post_id)",
        cascade="all, delete-orphan",
        passive_deletes=True,
        viewonly=False,
    )
    reactions = relationship(
        "ForumReaction",
        primaryjoin="ForumPost.id == foreign(ForumReaction.post_id)",
        cascade="all, delete-orphan",
        passive_deletes=True,
        viewonly=False,
    )


class ForumComment(Base):
    """A comment on a post, optionally nested under another comment."""

    __tablename__ = "forum_comments"
    __table_args__ = ({"extend_existing": True},)

    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("forum_posts.id", ondelete="CASCADE"), nullable=False, index=True)
    parent_comment_id = Column(
        Integer, ForeignKey("forum_comments.id", ondelete="CASCADE"), nullable=True, index=True
    )
    author_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)

    body = Column(Text, nullable=False, default="")  # Markdown
    is_deleted = Column(Boolean, default=False, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    post = relationship("ForumPost", back_populates="comments")
    author = relationship("User", foreign_keys=[author_id])
    attachments = relationship(
        "ForumAttachment",
        primaryjoin="ForumComment.id == foreign(ForumAttachment.comment_id)",
        cascade="all, delete-orphan",
        passive_deletes=True,
        viewonly=False,
    )
    reactions = relationship(
        "ForumReaction",
        primaryjoin="ForumComment.id == foreign(ForumReaction.comment_id)",
        cascade="all, delete-orphan",
        passive_deletes=True,
        viewonly=False,
    )


class ForumAttachment(Base):
    """A file attached to a post or a comment."""

    __tablename__ = "forum_attachments"
    __table_args__ = ({"extend_existing": True},)

    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("forum_posts.id", ondelete="CASCADE"), nullable=True, index=True)
    comment_id = Column(Integer, ForeignKey("forum_comments.id", ondelete="CASCADE"), nullable=True, index=True)
    uploader_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    file_name = Column(String, nullable=False)  # stored unique name on disk
    original_name = Column(String, nullable=False)
    file_type = Column(String, nullable=True)  # MIME type
    file_size = Column(Integer, nullable=True)
    kind = Column(String(20), default="document", nullable=False)  # image | video | document | other

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    uploader = relationship("User", foreign_keys=[uploader_id])


class ForumReaction(Base):
    """A reaction (e.g. like) on a post or comment by a single user."""

    __tablename__ = "forum_reactions"
    __table_args__ = (
        UniqueConstraint("user_id", "post_id", "comment_id", "reaction", name="uq_forum_reaction"),
        {"extend_existing": True},
    )

    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("forum_posts.id", ondelete="CASCADE"), nullable=True, index=True)
    comment_id = Column(Integer, ForeignKey("forum_comments.id", ondelete="CASCADE"), nullable=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    reaction = Column(String(20), default="like", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    user = relationship("User", foreign_keys=[user_id])
