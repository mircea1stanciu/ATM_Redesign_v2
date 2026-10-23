"""Pydantic schemas for the Community Forum API."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Authors / attachments (shared)
# ---------------------------------------------------------------------------
class ForumAuthor(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: Optional[int] = None
    username: Optional[str] = None
    full_name: Optional[str] = None
    role: Optional[str] = None


class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    file_name: str
    original_name: str
    file_type: Optional[str] = None
    file_size: Optional[int] = None
    kind: str
    url: str
    created_at: datetime


# ---------------------------------------------------------------------------
# Posts
# ---------------------------------------------------------------------------
class PostCreate(BaseModel):
    community_id: str = Field(..., min_length=1, max_length=50)
    title: str = Field(..., min_length=1, max_length=300)
    body: str = Field(default="", max_length=50_000)
    tags: list[str] = Field(default_factory=list)
    attachment_ids: list[int] = Field(default_factory=list)


class PostUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=300)
    body: Optional[str] = Field(default=None, max_length=50_000)
    tags: Optional[list[str]] = None


class PostModeration(BaseModel):
    is_pinned: Optional[bool] = None
    is_locked: Optional[bool] = None


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    community_id: str
    title: str
    body: str
    tags: list[str] = Field(default_factory=list)
    is_pinned: bool
    is_locked: bool
    view_count: int
    created_at: datetime
    updated_at: datetime
    author: Optional[ForumAuthor] = None
    attachments: list[AttachmentOut] = Field(default_factory=list)
    comment_count: int = 0
    like_count: int = 0
    liked_by_me: bool = False
    can_edit: bool = False
    can_moderate: bool = False


class PostListResponse(BaseModel):
    items: list[PostOut]
    total: int
    page: int
    page_size: int


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------
class CommentCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=20_000)
    parent_comment_id: Optional[int] = None
    attachment_ids: list[int] = Field(default_factory=list)


class CommentUpdate(BaseModel):
    body: str = Field(..., min_length=1, max_length=20_000)


class CommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    post_id: int
    parent_comment_id: Optional[int] = None
    body: str
    created_at: datetime
    updated_at: datetime
    author: Optional[ForumAuthor] = None
    attachments: list[AttachmentOut] = Field(default_factory=list)
    like_count: int = 0
    liked_by_me: bool = False
    can_edit: bool = False
    can_moderate: bool = False


# ---------------------------------------------------------------------------
# Reactions
# ---------------------------------------------------------------------------
class ReactionResponse(BaseModel):
    liked: bool
    like_count: int
