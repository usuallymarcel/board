"""Shared route dependencies and the lookups that keep every query inside one user's scope."""
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auth import AuthContext, require_access
from app.config import Settings
from app.db import get_db, get_write_db, utcnow
from app.models import BoardColumn, Card, Collection, Item

Auth = Annotated[AuthContext, Depends(require_access)]
ReadDb = Annotated[Session, Depends(get_db)]
WriteDb = Annotated[Session, Depends(get_write_db)]


def settings_of(request: Request) -> Settings:
    return request.app.state.settings


Config = Annotated[Settings, Depends(settings_of)]


def own_item(db: Session, auth: AuthContext, item_id: str, kind: str | None = None, *, trashed: bool = False) -> Item:
    """404, never 403, so nobody can probe which ids exist."""
    item = db.get(Item, item_id)
    if item is None or item.scope != auth.scope or (kind and item.kind != kind) or (item.deleted_at is not None and not trashed):
        raise HTTPException(404, 'Not found.')
    return item


def own_collection(db: Session, auth: AuthContext, collection_id: str) -> Collection:
    collection = db.get(Collection, collection_id)
    if collection is None or collection.scope != auth.scope:
        raise HTTPException(404, 'Collection not found.')
    return collection


def check_collection(db: Session, auth: AuthContext, collection_id: str | None) -> str | None:
    if collection_id is not None:
        own_collection(db, auth, collection_id)
    return collection_id


def own_column(db: Session, auth: AuthContext, column_id: int) -> tuple[BoardColumn, Item]:
    column = db.get(BoardColumn, column_id)
    if column is None:
        raise HTTPException(404, 'Not found.')
    return column, own_item(db, auth, column.board_id, 'board')


def own_card(db: Session, auth: AuthContext, card_id: int) -> tuple[Card, Item]:
    card = db.get(Card, card_id)
    if card is None:
        raise HTTPException(404, 'Not found.')
    return card, own_item(db, auth, card.board_id, 'board')


def touch(item: Item) -> None:
    item.updated_at = utcnow()


def place(rows: list, target, index: int) -> None:
    """Puts target at index among rows and renumbers. Sibling lists are small enough that
    renumbering beats the rounding and rebalancing fractional positions need."""
    others = [row for row in rows if row is not target]
    others.insert(min(index, len(others)), target)
    for position, row in enumerate(others):
        row.position = position


def client_ip(request: Request) -> str:
    return request.client.host if request.client else 'unknown'


def throttle(request: Request, limiter_name: str, key: str) -> None:
    wait = getattr(request.app.state, limiter_name).retry_after(key)
    if wait:
        raise HTTPException(429, 'Too many attempts. Try again in a minute.', headers={'Retry-After': str(int(wait) + 1)})


def like(term: str) -> str:
    escaped = term.replace('\\', r'\\').replace('%', r'\%').replace('_', r'\_')
    return f'%{escaped}%'
