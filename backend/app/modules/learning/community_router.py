"""Community (back in phase 21): questions and answers between the people who learn and build tests. One Community per
organisation, stored in the forum tables kept since phase 13. Leads and Super Admins pin, lock and remove posts."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.permissions import has_permission, require
from app.modules.identity.models import User
from app.modules.learning.models import ForumComment, ForumPost, ForumReaction
from app.modules.notifications.service import notify

router = APIRouter(prefix="/api/community", tags=["Community"])

COMMUNITY = "general"  # the forum tables scope posts by community; there is one per organisation now
MAX_TAGS = 5
LIKE = "like"


def _person(user: Optional[User]) -> Optional[str]:
    return (user.full_name or user.username) if user else None


def _moderator(user: User) -> bool:
    return has_permission(user, "learning.manage")


def _visible(query, user: User):
    return query.filter(ForumPost.community_id == COMMUNITY, ForumPost.is_deleted.is_(False),
                        or_(ForumPost.organization_id.is_(None), ForumPost.organization_id == user.organization_id))


def _likes(db: Session, user: User, *, post_ids=(), comment_ids=()) -> tuple[dict, set]:
    """Like counts by post or comment id, and the ids the user liked."""
    column = ForumReaction.post_id if post_ids else ForumReaction.comment_id
    ids = list(post_ids or comment_ids)
    if not ids:
        return {}, set()
    query = db.query(ForumReaction).filter(column.in_(ids), ForumReaction.reaction == LIKE)
    if post_ids:
        query = query.filter(ForumReaction.comment_id.is_(None))
    counts: dict = {}
    mine = set()
    for reaction in query:
        key = reaction.post_id if post_ids else reaction.comment_id
        counts[key] = counts.get(key, 0) + 1
        if reaction.user_id == user.id:
            mine.add(key)
    return counts, mine


def _post_summary(post: ForumPost, user: User, answers: int, likes: int, liked: bool) -> dict:
    return {"id": post.id, "title": post.title, "tags": list(post.tags or []), "author": _person(post.author),
            "author_id": post.author_id, "pinned": bool(post.is_pinned), "locked": bool(post.is_locked),
            "answers": answers, "likes": likes, "liked": liked, "created_at": post.created_at.isoformat(),
            "updated_at": post.updated_at.isoformat(),
            "can_edit": post.author_id == user.id or _moderator(user)}


@router.get("/posts")
async def list_posts(q: Optional[str] = Query(None, max_length=200), tag: Optional[str] = Query(None, max_length=40),
                     limit: int = Query(50, ge=1, le=200), current_user: User = Depends(require("learning.use")),
                     db: Session = Depends(get_db)):
    """The questions, pinned first, then the newest; with a text search and a tag filter."""
    query = _visible(db.query(ForumPost), current_user)
    if q and q.strip():
        like = f"%{q.strip()}%"
        query = query.filter(or_(ForumPost.title.ilike(like), ForumPost.body.ilike(like)))
    posts = query.order_by(ForumPost.is_pinned.desc(), ForumPost.created_at.desc(), ForumPost.id.desc()).all()
    if tag:
        posts = [p for p in posts if tag in (p.tags or [])]
    posts = posts[:limit]
    ids = [p.id for p in posts]
    answers = dict(db.query(ForumComment.post_id, func.count(ForumComment.id))
                   .filter(ForumComment.post_id.in_(ids), ForumComment.is_deleted.is_(False))
                   .group_by(ForumComment.post_id).all()) if ids else {}
    likes, mine = _likes(db, current_user, post_ids=ids)
    tags = sorted({t for p in _visible(db.query(ForumPost.tags), current_user).all() for t in (p.tags or [])})
    return {"items": [_post_summary(p, current_user, answers.get(p.id, 0), likes.get(p.id, 0), p.id in mine)
                      for p in posts],
            "tags": tags, "can_moderate": _moderator(current_user)}


class PostPayload(BaseModel):
    title: str = Field(min_length=3, max_length=300)
    body: str = Field(default="", max_length=20_000)
    tags: list[str] = Field(default_factory=list, max_length=MAX_TAGS)


def _clean_tags(tags: list[str]) -> list[str]:
    cleaned = []
    for tag in tags:
        value = tag.strip().lower().replace(" ", "-")[:40]
        if value and value not in cleaned:
            cleaned.append(value)
    return cleaned


@router.post("/posts", status_code=201)
async def create_post(payload: PostPayload, current_user: User = Depends(require("learning.use")),
                      db: Session = Depends(get_db)):
    post = ForumPost(organization_id=current_user.organization_id, community_id=COMMUNITY, author_id=current_user.id,
                     title=payload.title.strip(), body=payload.body.strip(), tags=_clean_tags(payload.tags))
    db.add(post)
    db.commit()
    return await get_post(post.id, current_user, db)


def _find_post(db: Session, user: User, post_id: int) -> ForumPost:
    post = _visible(db.query(ForumPost), user).filter(ForumPost.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Question not found.")
    return post


def _answer(comment: ForumComment, user: User, likes: int, liked: bool) -> dict:
    return {"id": comment.id, "body": comment.body, "author": _person(comment.author),
            "author_id": comment.author_id, "parent_id": comment.parent_comment_id, "likes": likes, "liked": liked,
            "created_at": comment.created_at.isoformat(),
            "can_delete": comment.author_id == user.id or _moderator(user)}


@router.get("/posts/{post_id}")
async def get_post(post_id: int, current_user: User = Depends(require("learning.use")),
                   db: Session = Depends(get_db)):
    """A question with its answers, oldest first."""
    post = _find_post(db, current_user, post_id)
    answers = (db.query(ForumComment).filter(ForumComment.post_id == post.id, ForumComment.is_deleted.is_(False))
               .order_by(ForumComment.created_at, ForumComment.id).all())
    post_likes, post_mine = _likes(db, current_user, post_ids=[post.id])
    likes, mine = _likes(db, current_user, comment_ids=[a.id for a in answers])
    return {**_post_summary(post, current_user, len(answers), post_likes.get(post.id, 0), post.id in post_mine),
            "body": post.body,
            "answers_list": [_answer(a, current_user, likes.get(a.id, 0), a.id in mine) for a in answers],
            "can_moderate": _moderator(current_user)}


@router.put("/posts/{post_id}")
async def update_post(post_id: int, payload: PostPayload, current_user: User = Depends(require("learning.use")),
                      db: Session = Depends(get_db)):
    post = _find_post(db, current_user, post_id)
    if post.author_id != current_user.id and not _moderator(current_user):
        raise HTTPException(status_code=403, detail="Only the author or a lead edits a question.")
    db.query(ForumPost).filter(ForumPost.id == post.id).update(
        {"title": payload.title.strip(), "body": payload.body.strip(), "tags": _clean_tags(payload.tags)})
    db.commit()
    return await get_post(post.id, current_user, db)


@router.delete("/posts/{post_id}")
async def delete_post(post_id: int, current_user: User = Depends(require("learning.use")),
                      db: Session = Depends(get_db)):
    post = _find_post(db, current_user, post_id)
    if post.author_id != current_user.id and not _moderator(current_user):
        raise HTTPException(status_code=403, detail="Only the author or a lead removes a question.")
    db.query(ForumPost).filter(ForumPost.id == post.id).update({"is_deleted": True})
    db.commit()
    return {"deleted": post.id}


class Moderation(BaseModel):
    pinned: Optional[bool] = None
    locked: Optional[bool] = None


@router.post("/posts/{post_id}/moderate")
async def moderate_post(post_id: int, payload: Moderation, current_user: User = Depends(require("learning.manage")),
                        db: Session = Depends(get_db)):
    """Pin a question to the top, or lock it (no new answers)."""
    post = _find_post(db, current_user, post_id)
    changes = {}
    if payload.pinned is not None:
        changes["is_pinned"] = payload.pinned
    if payload.locked is not None:
        changes["is_locked"] = payload.locked
    if changes:
        db.query(ForumPost).filter(ForumPost.id == post.id).update(changes)
        db.commit()
    return await get_post(post.id, current_user, db)


class AnswerPayload(BaseModel):
    body: str = Field(min_length=1, max_length=20_000)
    parent_id: Optional[int] = None


@router.post("/posts/{post_id}/answers", status_code=201)
async def add_answer(post_id: int, payload: AnswerPayload, current_user: User = Depends(require("learning.use")),
                     db: Session = Depends(get_db)):
    """Answer a question (or reply to an answer); the question's author is told."""
    post = _find_post(db, current_user, post_id)
    if post.is_locked and not _moderator(current_user):
        raise HTTPException(status_code=400, detail="This question is locked: no new answers.")
    if payload.parent_id is not None and not db.query(ForumComment).filter(
            ForumComment.id == payload.parent_id, ForumComment.post_id == post.id).first():
        raise HTTPException(status_code=400, detail="That answer is not part of this question.")
    db.add(ForumComment(post_id=post.id, parent_comment_id=payload.parent_id, author_id=current_user.id,
                        body=payload.body.strip()))
    db.query(ForumPost).filter(ForumPost.id == post.id).update({"updated_at": func.now()})
    db.commit()
    if post.author_id and post.author_id != current_user.id:
        notify(db, [post.author_id], "community", f"{_person(current_user)} answered your question: {post.title}",
               payload.body.strip()[:300], f"/community/{post.id}")
    return await get_post(post.id, current_user, db)


@router.delete("/answers/{answer_id}")
async def delete_answer(answer_id: int, current_user: User = Depends(require("learning.use")),
                        db: Session = Depends(get_db)):
    answer = db.query(ForumComment).filter(ForumComment.id == answer_id, ForumComment.is_deleted.is_(False)).first()
    if not answer:
        raise HTTPException(status_code=404, detail="Answer not found.")
    _find_post(db, current_user, answer.post_id)
    if answer.author_id != current_user.id and not _moderator(current_user):
        raise HTTPException(status_code=403, detail="Only the author or a lead removes an answer.")
    db.query(ForumComment).filter(ForumComment.id == answer.id).update({"is_deleted": True})
    db.commit()
    return {"deleted": answer.id}


def _reactions(db: Session, post_id: Optional[int], comment_id: Optional[int]):
    """The likes of a question (post_id) or of an answer (comment_id)."""
    query = db.query(ForumReaction).filter(ForumReaction.reaction == LIKE)
    if comment_id:
        return query.filter(ForumReaction.comment_id == comment_id)
    return query.filter(ForumReaction.post_id == post_id, ForumReaction.comment_id.is_(None))


def _toggle(db: Session, user: User, post_id: Optional[int], comment_id: Optional[int]) -> dict:
    found = _reactions(db, post_id, comment_id).filter(ForumReaction.user_id == user.id).first()
    if found:
        db.delete(found)
    else:
        db.add(ForumReaction(user_id=user.id, post_id=post_id, comment_id=comment_id, reaction=LIKE))
    db.commit()
    return {"liked": not found, "likes": _reactions(db, post_id, comment_id).count()}


@router.post("/posts/{post_id}/like")
async def like_post(post_id: int, current_user: User = Depends(require("learning.use")),
                    db: Session = Depends(get_db)):
    post = _find_post(db, current_user, post_id)
    return _toggle(db, current_user, post.id, None)


@router.post("/answers/{answer_id}/like")
async def like_answer(answer_id: int, current_user: User = Depends(require("learning.use")),
                      db: Session = Depends(get_db)):
    answer = db.query(ForumComment).filter(ForumComment.id == answer_id, ForumComment.is_deleted.is_(False)).first()
    if not answer:
        raise HTTPException(status_code=404, detail="Answer not found.")
    _find_post(db, current_user, answer.post_id)
    return _toggle(db, current_user, None, answer.id)
