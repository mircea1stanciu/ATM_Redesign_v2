"""Community Forum API.

Per-community discussion forum: posts, threaded comments, file attachments and
reactions. Scoped by ``community_id`` (e.g. ``qa``, ``backend``). Uses the async
SQLite session and the ``core.database.User`` returned by ``get_current_user``.
"""
import os
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints.auth import get_current_user
from app.db.session import get_db
from app.models.community_forum import (
    ForumAttachment,
    ForumComment,
    ForumPost,
    ForumReaction,
)
from app.schemas.community import (
    AttachmentOut,
    CommentCreate,
    CommentOut,
    CommentUpdate,
    PostCreate,
    PostListResponse,
    PostModeration,
    PostOut,
    PostUpdate,
    ReactionResponse,
)

router = APIRouter()

# ── Upload configuration ─────────────────────────────────────────────────────
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))), "uploads", "community")
os.makedirs(UPLOAD_DIR, exist_ok=True)

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB

IMAGE_EXT = {"png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"}
VIDEO_EXT = {"mp4", "webm", "mov", "m4v", "ogg"}
DOC_EXT = {
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "csv",
    "json", "log", "zip", "rtf",
}
ALLOWED_EXT = IMAGE_EXT | VIDEO_EXT | DOC_EXT

MODERATOR_ROLES = {"super_admin", "admin", "org_admin", "community_lead", "automation_lead"}


# ── Helpers ──────────────────────────────────────────────────────────────────
def _role_value(user) -> str:
    role = getattr(user, "role", None)
    return role.value if hasattr(role, "value") else str(role or "")


def _assigned_communities(user) -> list[str]:
    raw = getattr(user, "assigned_communities", None)
    if not raw:
        return []
    if isinstance(raw, list):
        return raw
    try:
        import json
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


def _can_moderate(user, community_id: Optional[str] = None) -> bool:
    role = _role_value(user)
    if role in {"super_admin", "admin", "org_admin"}:
        return True
    if role in {"community_lead", "automation_lead"}:
        if community_id is None:
            return True
        return community_id in _assigned_communities(user)
    return False


def _ensure_can_access(user, community_id: str) -> None:
    """Soft per-community access check.

    Moderators can access any community. Regular users may access a community if
    it is in their assigned list, or if they have no assignments configured
    (so the forum is not accidentally locked for everyone).
    """
    if _can_moderate(user):
        return
    assigned = _assigned_communities(user)
    if assigned and community_id not in assigned:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this community.",
        )


def _detect_kind(ext: str) -> str:
    if ext in IMAGE_EXT:
        return "image"
    if ext in VIDEO_EXT:
        return "video"
    if ext in DOC_EXT:
        return "document"
    return "other"


def _attachment_out(att: ForumAttachment) -> AttachmentOut:
    return AttachmentOut(
        id=att.id,
        file_name=att.file_name,
        original_name=att.original_name,
        file_type=att.file_type,
        file_size=att.file_size,
        kind=att.kind,
        url=f"/api/v1/community/attachments/{att.file_name}",
        created_at=att.created_at,
    )


def _author_dict(user) -> Optional[dict]:
    if not user:
        return None
    return {
        "id": getattr(user, "id", None),
        "username": getattr(user, "username", None),
        "full_name": getattr(user, "full_name", None),
        "role": _role_value(user),
    }


async def _link_attachments(
    db: AsyncSession,
    attachment_ids: list[int],
    uploader_id: int,
    *,
    post_id: Optional[int] = None,
    comment_id: Optional[int] = None,
) -> None:
    """Attach previously-uploaded, still-unlinked files to a post or comment."""
    if not attachment_ids:
        return
    result = await db.execute(
        select(ForumAttachment).where(
            ForumAttachment.id.in_(attachment_ids),
            ForumAttachment.uploader_id == uploader_id,
            ForumAttachment.post_id.is_(None),
            ForumAttachment.comment_id.is_(None),
        )
    )
    for att in result.scalars().all():
        att.post_id = post_id
        att.comment_id = comment_id


# ── Attachments ──────────────────────────────────────────────────────────────
@router.post("/attachments", response_model=AttachmentOut, status_code=status.HTTP_201_CREATED)
async def upload_attachment(
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload a single file. Returns an attachment id to link to a post/comment."""
    if not file.filename or "." not in file.filename:
        raise HTTPException(status_code=400, detail="A file with an extension is required.")

    ext = file.filename.rsplit(".", 1)[1].lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(
            status_code=400,
            detail=f"File type '.{ext}' is not allowed.",
        )

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024 * 1024)}MB.",
        )

    stored_name = f"{uuid.uuid4().hex}.{ext}"
    with open(os.path.join(UPLOAD_DIR, stored_name), "wb") as f:
        f.write(content)

    att = ForumAttachment(
        uploader_id=current_user.id,
        file_name=stored_name,
        original_name=file.filename,
        file_type=file.content_type,
        file_size=len(content),
        kind=_detect_kind(ext),
    )
    db.add(att)
    await db.commit()
    await db.refresh(att)
    return _attachment_out(att)


@router.get("/attachments/{file_name}")
async def download_attachment(
    file_name: str,
    current_user=Depends(get_current_user),
):
    """Serve an uploaded attachment (authenticated)."""
    # Prevent path traversal — only allow plain file names.
    safe_name = os.path.basename(file_name)
    file_path = os.path.join(UPLOAD_DIR, safe_name)
    if safe_name != file_name or not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="Attachment not found.")
    return FileResponse(file_path)


# ── Post serialization ───────────────────────────────────────────────────────
async def _serialize_posts(
    db: AsyncSession, posts: list[ForumPost], current_user
) -> list[PostOut]:
    if not posts:
        return []
    post_ids = [p.id for p in posts]

    # comment counts
    comment_counts = dict(
        (
            await db.execute(
                select(ForumComment.post_id, func.count(ForumComment.id))
                .where(ForumComment.post_id.in_(post_ids), ForumComment.is_deleted.is_(False))
                .group_by(ForumComment.post_id)
            )
        ).all()
    )
    # like counts
    like_counts = dict(
        (
            await db.execute(
                select(ForumReaction.post_id, func.count(ForumReaction.id))
                .where(ForumReaction.post_id.in_(post_ids))
                .group_by(ForumReaction.post_id)
            )
        ).all()
    )
    # liked by me
    liked_by_me = set(
        (
            await db.execute(
                select(ForumReaction.post_id).where(
                    ForumReaction.post_id.in_(post_ids),
                    ForumReaction.user_id == current_user.id,
                )
            )
        ).scalars().all()
    )

    out: list[PostOut] = []
    for p in posts:
        can_moderate = _can_moderate(current_user, p.community_id)
        out.append(
            PostOut(
                id=p.id,
                community_id=p.community_id,
                title=p.title,
                body=p.body,
                tags=p.tags or [],
                is_pinned=p.is_pinned,
                is_locked=p.is_locked,
                view_count=p.view_count,
                created_at=p.created_at,
                updated_at=p.updated_at,
                author=_author_dict(p.author),
                attachments=[_attachment_out(a) for a in sorted(p.attachments, key=lambda x: x.id)],
                comment_count=comment_counts.get(p.id, 0),
                like_count=like_counts.get(p.id, 0),
                liked_by_me=p.id in liked_by_me,
                can_edit=(p.author_id == current_user.id) or can_moderate,
                can_moderate=can_moderate,
            )
        )
    return out


# ── Posts ────────────────────────────────────────────────────────────────────
@router.get("/posts", response_model=PostListResponse)
async def list_posts(
    community_id: str = Query(...),
    search: Optional[str] = Query(None),
    tags: Optional[str] = Query(None),
    sort: str = Query("latest", pattern="^(latest|top)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=50),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_can_access(current_user, community_id)

    filters = [ForumPost.community_id == community_id, ForumPost.is_deleted.is_(False)]
    if search:
        like = f"%{search.strip()}%"
        filters.append(or_(ForumPost.title.ilike(like), ForumPost.body.ilike(like)))

    total = (
        await db.execute(select(func.count(ForumPost.id)).where(*filters))
    ).scalar_one()

    base = (
        select(ForumPost)
        .where(*filters)
        .options(selectinload(ForumPost.author), selectinload(ForumPost.attachments))
    )

    if sort == "top":
        like_sub = (
            select(ForumReaction.post_id, func.count(ForumReaction.id).label("c"))
            .group_by(ForumReaction.post_id)
            .subquery()
        )
        base = base.outerjoin(like_sub, like_sub.c.post_id == ForumPost.id).order_by(
            ForumPost.is_pinned.desc(), func.coalesce(like_sub.c.c, 0).desc(), ForumPost.created_at.desc()
        )
    else:
        base = base.order_by(ForumPost.is_pinned.desc(), ForumPost.created_at.desc())

    base = base.offset((page - 1) * page_size).limit(page_size)
    posts = list((await db.execute(base)).scalars().unique().all())

    items = await _serialize_posts(db, posts, current_user)

    # In-memory tag filter (SQLite JSON filtering is limited). AND logic: post must contain all selected tags.
    if tags:
        selected_tags = {t.strip().lower() for t in tags.split(",") if t.strip()}
        items = [i for i in items if selected_tags <= {t.lower() for t in (i.tags or [])}]

    return PostListResponse(items=items, total=total, page=page, page_size=page_size)


@router.get("/posts/tags/all")
async def get_available_tags(
    community_id: str = Query(...),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get all unique tags used in posts for a community, with their usage counts."""
    _ensure_can_access(current_user, community_id)
    
    posts = (
        await db.execute(
            select(ForumPost.tags).where(
                ForumPost.community_id == community_id, ForumPost.is_deleted.is_(False)
            )
        )
    ).scalars().all()
    
    # Flatten tags and count occurrences
    tag_counts = {}
    for tag_list in posts:
        if tag_list:
            for tag in tag_list:
                tag_lower = tag.lower().strip()
                tag_counts[tag_lower] = tag_counts.get(tag_lower, 0) + 1
    
    # Sort by count (descending) then alphabetically
    sorted_tags = sorted(tag_counts.items(), key=lambda x: (-x[1], x[0]))
    
    return {
        "tags": [{"name": tag, "count": count} for tag, count in sorted_tags]
    }


@router.post("/posts", response_model=PostOut, status_code=status.HTTP_201_CREATED)
async def create_post(
    payload: PostCreate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_can_access(current_user, payload.community_id)

    post = ForumPost(
        community_id=payload.community_id,
        author_id=current_user.id,
        organization_id=getattr(current_user, "organization_id", None),
        title=payload.title.strip(),
        body=payload.body,
        tags=[t.strip() for t in payload.tags if t.strip()][:10],
    )
    db.add(post)
    await db.flush()
    await _link_attachments(db, payload.attachment_ids, current_user.id, post_id=post.id)
    await db.commit()

    post = (
        await db.execute(
            select(ForumPost)
            .where(ForumPost.id == post.id)
            .options(selectinload(ForumPost.author), selectinload(ForumPost.attachments))
        )
    ).scalar_one()
    return (await _serialize_posts(db, [post], current_user))[0]


@router.get("/posts/{post_id}", response_model=PostOut)
async def get_post(
    post_id: int,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    post = (
        await db.execute(
            select(ForumPost)
            .where(ForumPost.id == post_id, ForumPost.is_deleted.is_(False))
            .options(selectinload(ForumPost.author), selectinload(ForumPost.attachments))
        )
    ).scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found.")
    _ensure_can_access(current_user, post.community_id)

    post.view_count = (post.view_count or 0) + 1
    await db.commit()
    await db.refresh(post)
    return (await _serialize_posts(db, [post], current_user))[0]


async def _get_owned_post(db: AsyncSession, post_id: int, current_user, *, moderate: bool = False) -> ForumPost:
    post = (
        await db.execute(
            select(ForumPost)
            .where(ForumPost.id == post_id, ForumPost.is_deleted.is_(False))
            .options(selectinload(ForumPost.author), selectinload(ForumPost.attachments))
        )
    ).scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found.")
    allowed = _can_moderate(current_user, post.community_id)
    if not moderate:
        allowed = allowed or post.author_id == current_user.id
    if not allowed:
        raise HTTPException(status_code=403, detail="Not allowed.")
    return post


@router.patch("/posts/{post_id}", response_model=PostOut)
async def update_post(
    post_id: int,
    payload: PostUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    post = await _get_owned_post(db, post_id, current_user)
    if post.is_locked and not _can_moderate(current_user, post.community_id):
        raise HTTPException(status_code=403, detail="This post is locked.")
    if payload.title is not None:
        post.title = payload.title.strip()
    if payload.body is not None:
        post.body = payload.body
    if payload.tags is not None:
        post.tags = [t.strip() for t in payload.tags if t.strip()][:10]
    await db.commit()
    await db.refresh(post)
    return (await _serialize_posts(db, [post], current_user))[0]


@router.patch("/posts/{post_id}/moderate", response_model=PostOut)
async def moderate_post(
    post_id: int,
    payload: PostModeration,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    post = await _get_owned_post(db, post_id, current_user, moderate=True)
    if payload.is_pinned is not None:
        post.is_pinned = payload.is_pinned
    if payload.is_locked is not None:
        post.is_locked = payload.is_locked
    await db.commit()
    await db.refresh(post)
    return (await _serialize_posts(db, [post], current_user))[0]


@router.delete("/posts/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_post(
    post_id: int,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    post = await _get_owned_post(db, post_id, current_user)
    post.is_deleted = True
    await db.commit()


# ── Comment serialization ────────────────────────────────────────────────────
async def _serialize_comments(
    db: AsyncSession, comments: list[ForumComment], current_user
) -> list[CommentOut]:
    if not comments:
        return []
    ids = [c.id for c in comments]
    like_counts = dict(
        (
            await db.execute(
                select(ForumReaction.comment_id, func.count(ForumReaction.id))
                .where(ForumReaction.comment_id.in_(ids))
                .group_by(ForumReaction.comment_id)
            )
        ).all()
    )
    liked_by_me = set(
        (
            await db.execute(
                select(ForumReaction.comment_id).where(
                    ForumReaction.comment_id.in_(ids),
                    ForumReaction.user_id == current_user.id,
                )
            )
        ).scalars().all()
    )
    out: list[CommentOut] = []
    for c in comments:
        can_moderate = _can_moderate(current_user)
        out.append(
            CommentOut(
                id=c.id,
                post_id=c.post_id,
                parent_comment_id=c.parent_comment_id,
                body=c.body,
                created_at=c.created_at,
                updated_at=c.updated_at,
                author=_author_dict(c.author),
                attachments=[_attachment_out(a) for a in sorted(c.attachments, key=lambda x: x.id)],
                like_count=like_counts.get(c.id, 0),
                liked_by_me=c.id in liked_by_me,
                can_edit=(c.author_id == current_user.id) or can_moderate,
                can_moderate=can_moderate,
            )
        )
    return out


# ── Comments ─────────────────────────────────────────────────────────────────
@router.get("/posts/{post_id}/comments", response_model=list[CommentOut])
async def list_comments(
    post_id: int,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    post = (
        await db.execute(select(ForumPost).where(ForumPost.id == post_id, ForumPost.is_deleted.is_(False)))
    ).scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found.")
    _ensure_can_access(current_user, post.community_id)

    comments = list(
        (
            await db.execute(
                select(ForumComment)
                .where(ForumComment.post_id == post_id, ForumComment.is_deleted.is_(False))
                .options(selectinload(ForumComment.author), selectinload(ForumComment.attachments))
                .order_by(ForumComment.created_at.asc())
            )
        ).scalars().unique().all()
    )
    return await _serialize_comments(db, comments, current_user)


@router.post("/posts/{post_id}/comments", response_model=CommentOut, status_code=status.HTTP_201_CREATED)
async def create_comment(
    post_id: int,
    payload: CommentCreate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    post = (
        await db.execute(select(ForumPost).where(ForumPost.id == post_id, ForumPost.is_deleted.is_(False)))
    ).scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found.")
    _ensure_can_access(current_user, post.community_id)
    if post.is_locked and not _can_moderate(current_user, post.community_id):
        raise HTTPException(status_code=403, detail="This post is locked.")

    if payload.parent_comment_id is not None:
        parent = (
            await db.execute(
                select(ForumComment).where(
                    ForumComment.id == payload.parent_comment_id,
                    ForumComment.post_id == post_id,
                    ForumComment.is_deleted.is_(False),
                )
            )
        ).scalar_one_or_none()
        if not parent:
            raise HTTPException(status_code=400, detail="Parent comment not found.")

    comment = ForumComment(
        post_id=post_id,
        parent_comment_id=payload.parent_comment_id,
        author_id=current_user.id,
        body=payload.body,
    )
    db.add(comment)
    await db.flush()
    await _link_attachments(db, payload.attachment_ids, current_user.id, comment_id=comment.id)
    await db.commit()

    comment = (
        await db.execute(
            select(ForumComment)
            .where(ForumComment.id == comment.id)
            .options(selectinload(ForumComment.author), selectinload(ForumComment.attachments))
        )
    ).scalar_one()
    return (await _serialize_comments(db, [comment], current_user))[0]


async def _get_owned_comment(db: AsyncSession, comment_id: int, current_user) -> ForumComment:
    comment = (
        await db.execute(
            select(ForumComment)
            .where(ForumComment.id == comment_id, ForumComment.is_deleted.is_(False))
            .options(selectinload(ForumComment.author), selectinload(ForumComment.attachments))
        )
    ).scalar_one_or_none()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found.")
    if comment.author_id != current_user.id and not _can_moderate(current_user):
        raise HTTPException(status_code=403, detail="Not allowed.")
    return comment


@router.patch("/comments/{comment_id}", response_model=CommentOut)
async def update_comment(
    comment_id: int,
    payload: CommentUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    comment = await _get_owned_comment(db, comment_id, current_user)
    comment.body = payload.body
    await db.commit()
    await db.refresh(comment)
    return (await _serialize_comments(db, [comment], current_user))[0]


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    comment_id: int,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    comment = await _get_owned_comment(db, comment_id, current_user)
    comment.is_deleted = True
    await db.commit()


# ── Reactions ────────────────────────────────────────────────────────────────
async def _toggle_reaction(
    db: AsyncSession, current_user, *, post_id: Optional[int] = None, comment_id: Optional[int] = None
) -> ReactionResponse:
    existing = (
        await db.execute(
            select(ForumReaction).where(
                ForumReaction.user_id == current_user.id,
                ForumReaction.post_id.is_(post_id) if post_id is None else ForumReaction.post_id == post_id,
                ForumReaction.comment_id.is_(comment_id)
                if comment_id is None
                else ForumReaction.comment_id == comment_id,
                ForumReaction.reaction == "like",
            )
        )
    ).scalar_one_or_none()

    if existing:
        await db.delete(existing)
        liked = False
    else:
        db.add(
            ForumReaction(post_id=post_id, comment_id=comment_id, user_id=current_user.id, reaction="like")
        )
        liked = True
    await db.commit()

    count_filter = ForumReaction.post_id == post_id if post_id else ForumReaction.comment_id == comment_id
    count = (await db.execute(select(func.count(ForumReaction.id)).where(count_filter))).scalar_one()
    return ReactionResponse(liked=liked, like_count=count)


@router.post("/posts/{post_id}/like", response_model=ReactionResponse)
async def toggle_post_like(
    post_id: int,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    post = (
        await db.execute(select(ForumPost).where(ForumPost.id == post_id, ForumPost.is_deleted.is_(False)))
    ).scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found.")
    _ensure_can_access(current_user, post.community_id)
    return await _toggle_reaction(db, current_user, post_id=post_id)


@router.post("/comments/{comment_id}/like", response_model=ReactionResponse)
async def toggle_comment_like(
    comment_id: int,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    comment = (
        await db.execute(
            select(ForumComment).where(ForumComment.id == comment_id, ForumComment.is_deleted.is_(False))
        )
    ).scalar_one_or_none()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found.")
    return await _toggle_reaction(db, current_user, comment_id=comment_id)
