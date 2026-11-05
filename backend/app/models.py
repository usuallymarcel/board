"""Items are the one thing every feature shares: notes, boards and files all live in collections,
pin, move, trash and search the same way. Kind-specific data hangs off them."""
from datetime import date, datetime

from sqlalchemy import JSON, BigInteger, Boolean, Date, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, UTCDateTime, utcnow

ID = String(32)


class Collection(Base):
    __tablename__ = 'collections'

    id: Mapped[str] = mapped_column(ID, primary_key=True)
    scope: Mapped[int] = mapped_column(Integer, index=True)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey('collections.id', ondelete='SET NULL'), index=True)
    name: Mapped[str] = mapped_column(String(120))
    color: Mapped[str | None] = mapped_column(String(7))
    icon: Mapped[str | None] = mapped_column(String(16))
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Item(Base):
    __tablename__ = 'items'
    __table_args__ = (Index('ix_items_scope_kind', 'scope', 'kind', 'deleted_at'),)

    id: Mapped[str] = mapped_column(ID, primary_key=True)
    scope: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(10))  # note | board | file
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text, default='')  # note text, board description
    collection_id: Mapped[str | None] = mapped_column(ForeignKey('collections.id', ondelete='SET NULL'), index=True)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    file: Mapped['FileBlob | None'] = relationship(back_populates='item', uselist=False, cascade='all, delete-orphan', lazy='joined')


class FileBlob(Base):
    __tablename__ = 'files'

    item_id: Mapped[str] = mapped_column(ForeignKey('items.id', ondelete='CASCADE'), primary_key=True)
    stored_name: Mapped[str] = mapped_column(String(64))
    filename: Mapped[str] = mapped_column(String(255))
    mime: Mapped[str] = mapped_column(String(127))
    size: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    # Pasted into markdown: readable by anyone holding the unguessable URL, so it can appear in
    # forum posts and shared notes.
    inline: Mapped[bool] = mapped_column(Boolean, default=False)

    item: Mapped[Item] = relationship(back_populates='file')


class BoardColumn(Base):
    __tablename__ = 'board_columns'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    board_id: Mapped[str] = mapped_column(ForeignKey('items.id', ondelete='CASCADE'), index=True)
    title: Mapped[str] = mapped_column(String(120))
    color: Mapped[str | None] = mapped_column(String(7))
    position: Mapped[int] = mapped_column(Integer, default=0)


class Card(Base):
    __tablename__ = 'cards'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    board_id: Mapped[str] = mapped_column(ForeignKey('items.id', ondelete='CASCADE'), index=True)
    column_id: Mapped[int] = mapped_column(ForeignKey('board_columns.id', ondelete='CASCADE'), index=True)
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text, default='')
    labels: Mapped[list] = mapped_column(JSON, default=list)
    due_date: Mapped[date | None] = mapped_column(Date)
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    color: Mapped[str | None] = mapped_column(String(7))
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class ShareLink(Base):
    """A read-only capability URL for one item. The token grants access only to data sitting in the
    same database, so it is stored readable and the owner can copy the link again."""

    __tablename__ = 'share_links'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scope: Mapped[int] = mapped_column(Integer, index=True)
    item_id: Mapped[str] = mapped_column(ForeignKey('items.id', ondelete='CASCADE'), index=True)
    token: Mapped[str] = mapped_column(String(64), unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(200))
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    max_views: Mapped[int | None] = mapped_column(Integer)
    views: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Secret(Base):
    """End-to-end encrypted: the browser encrypts, the key stays in the URL fragment, and the
    server only ever holds ciphertext."""

    __tablename__ = 'secrets'

    id: Mapped[str] = mapped_column(ID, primary_key=True)
    scope: Mapped[int] = mapped_column(Integer, index=True)
    label: Mapped[str] = mapped_column(String(200), default='')
    ciphertext: Mapped[str | None] = mapped_column(Text)  # cleared once used up
    iv: Mapped[str] = mapped_column(String(32))
    salt: Mapped[str | None] = mapped_column(String(44))
    verifier: Mapped[str | None] = mapped_column(String(64))
    max_views: Mapped[int] = mapped_column(Integer, default=1)
    views: Mapped[int] = mapped_column(Integer, default=0)
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class ForumPost(Base):
    __tablename__ = 'forum_posts'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    author_id: Mapped[int] = mapped_column(Integer, index=True)
    author_name: Mapped[str] = mapped_column(String(100))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(40), default='General', index=True)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    comment_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    activity_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)


class ForumComment(Base):
    __tablename__ = 'forum_comments'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey('forum_posts.id', ondelete='CASCADE'), index=True)
    author_id: Mapped[int] = mapped_column(Integer)
    author_name: Mapped[str] = mapped_column(String(100))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Preference(Base):
    __tablename__ = 'preferences'

    scope: Mapped[int] = mapped_column(Integer, primary_key=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
