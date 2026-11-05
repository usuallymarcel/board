"""The public side: anyone can read, an account is needed to write."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.auth import AuthContext, get_auth, is_admin, require_author
from app.db import utcnow
from app.models import ForumComment, ForumPost
from app.routes.deps import ReadDb, WriteDb, like, throttle
from app.schemas import CommentIn, CommentOut, PostDetail, PostIn, PostList, PostOut, PostPatch

router = APIRouter(prefix='/api/forum', tags=['forum'])

Author = Annotated[tuple[int, str], Depends(require_author)]
Viewer = Annotated[AuthContext, Depends(get_auth)]


def post_or_404(db: Session, post_id: int) -> ForumPost:
    post = db.get(ForumPost, post_id)
    if post is None:
        raise HTTPException(404, 'Post not found.')
    return post


def comment_or_404(db: Session, comment_id: int) -> ForumComment:
    comment = db.get(ForumComment, comment_id)
    if comment is None:
        raise HTTPException(404, 'Comment not found.')
    return comment


def require_owner(request: Request, viewer: AuthContext, author: tuple[int, str], owner_id: int) -> bool:
    """True when acting as a moderator rather than as the author."""
    admin = is_admin(request, viewer)
    if owner_id != author[0] and not admin:
        raise HTTPException(403, 'Only the author or a moderator can do that.')
    return admin


@router.get('/posts')
def list_posts(
    db: ReadDb,
    q: str | None = Query(default=None, max_length=200),
    category: str | None = Query(default=None, max_length=40),
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> PostList:
    where = []
    if category:
        where.append(ForumPost.category == category)
    if q and q.strip():
        pattern = like(q.strip())
        where.append(or_(ForumPost.title.ilike(pattern, escape='\\'), ForumPost.body.ilike(pattern, escape='\\')))
    total = db.scalar(select(func.count()).select_from(ForumPost).where(*where))
    posts = db.scalars(
        select(ForumPost).where(*where).order_by(ForumPost.pinned.desc(), ForumPost.activity_at.desc()).limit(limit).offset(offset),
    ).all()
    categories = db.scalars(select(ForumPost.category).distinct().order_by(ForumPost.category)).all()
    return PostList(posts=[PostOut.model_validate(p) for p in posts], total=total or 0, categories=list(categories))


@router.post('/posts', status_code=201)
def create_post(data: PostIn, request: Request, author: Author, db: WriteDb) -> PostOut:
    throttle(request, 'forum_limiter', f'user:{author[0]}')
    post = ForumPost(author_id=author[0], author_name=author[1], title=data.title, body=data.body, category=data.category)
    db.add(post)
    db.commit()
    return PostOut.model_validate(post)


@router.get('/posts/{post_id}')
def get_post(post_id: int, db: ReadDb) -> PostDetail:
    post = post_or_404(db, post_id)
    comments = db.scalars(select(ForumComment).where(ForumComment.post_id == post.id).order_by(ForumComment.id)).all()
    return PostDetail(
        **PostOut.model_validate(post).model_dump(),
        comments=[CommentOut.model_validate(c) for c in comments],
    )


@router.patch('/posts/{post_id}')
def patch_post(post_id: int, data: PostPatch, request: Request, author: Author, viewer: Viewer, db: WriteDb) -> PostOut:
    post = post_or_404(db, post_id)
    admin = require_owner(request, viewer, author, post.author_id)
    if (data.pinned is not None or data.locked is not None) and not admin:
        raise HTTPException(403, 'Only a moderator can pin or lock.')
    edited = False
    for name in ('title', 'body', 'category'):
        value = getattr(data, name)
        if value is not None:
            setattr(post, name, value)
            edited = True
    if data.pinned is not None:
        post.pinned = data.pinned
    if data.locked is not None:
        post.locked = data.locked
    if edited:
        post.updated_at = utcnow()
    db.commit()
    return PostOut.model_validate(post)


@router.delete('/posts/{post_id}', status_code=204)
def delete_post(post_id: int, request: Request, author: Author, viewer: Viewer, db: WriteDb) -> None:
    post = post_or_404(db, post_id)
    require_owner(request, viewer, author, post.author_id)
    db.delete(post)
    db.commit()


@router.post('/posts/{post_id}/comments', status_code=201)
def create_comment(post_id: int, data: CommentIn, request: Request, author: Author, viewer: Viewer, db: WriteDb) -> CommentOut:
    post = post_or_404(db, post_id)
    if post.locked and not is_admin(request, viewer):
        raise HTTPException(403, 'This post is locked.')
    throttle(request, 'forum_limiter', f'user:{author[0]}')
    comment = ForumComment(post_id=post.id, author_id=author[0], author_name=author[1], body=data.body)
    db.add(comment)
    post.comment_count += 1
    post.activity_at = utcnow()
    db.commit()
    return CommentOut.model_validate(comment)


@router.patch('/comments/{comment_id}')
def patch_comment(comment_id: int, data: CommentIn, author: Author, db: WriteDb) -> CommentOut:
    comment = comment_or_404(db, comment_id)
    # Moderators can remove a comment, but words are not put in someone's mouth.
    if comment.author_id != author[0]:
        raise HTTPException(403, 'Only the author can edit a comment.')
    comment.body = data.body
    comment.updated_at = utcnow()
    db.commit()
    return CommentOut.model_validate(comment)


@router.delete('/comments/{comment_id}', status_code=204)
def delete_comment(comment_id: int, request: Request, author: Author, viewer: Viewer, db: WriteDb) -> None:
    comment = comment_or_404(db, comment_id)
    require_owner(request, viewer, author, comment.author_id)
    post = db.get(ForumPost, comment.post_id)
    post.comment_count = max(0, post.comment_count - 1)
    db.delete(comment)
    db.commit()
