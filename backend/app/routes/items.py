"""What every kind of item has in common: listing, moving, pinning, trash."""
import shutil
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, defer

from app.config import Settings
from app.db import utcnow
from app.models import BoardColumn, Card, FileBlob, Item
from app.routes.deps import Auth, Config, ReadDb, WriteDb, check_collection, like, own_item, touch
from app.schemas import Bulk, FileMeta, ItemList, ItemOut, ItemPatch, Kind, Usage
from app.storage import keep_upload, new_id, remove_stored, stored_path

router = APIRouter(prefix='/api', tags=['items'])

SNIPPET = 180
SORTS = {
    'updated': Item.updated_at.desc(),
    'created': Item.created_at.desc(),
    'title': func.lower(Item.title).asc(),
}


def present(item: Item, snippet: str = '', card_count: int | None = None) -> ItemOut:
    return ItemOut(
        id=item.id, kind=item.kind, title=item.title, snippet=snippet, collection_id=item.collection_id,
        pinned=item.pinned, version=item.version, created_at=item.created_at, updated_at=item.updated_at,
        deleted_at=item.deleted_at, file=FileMeta.model_validate(item.file) if item.file else None, card_count=card_count,
    )


def purge(db: Session, settings: Settings, item: Item) -> None:
    if item.file:
        remove_stored(settings, item.file.stored_name)
    db.delete(item)


@router.get('/items')
def list_items(
    auth: Auth,
    db: ReadDb,
    kind: Kind | None = None,
    collection: str | None = None,
    unfiled: bool = False,
    q: str | None = Query(default=None, max_length=200),
    pinned: bool | None = None,
    trashed: bool = False,
    inline: bool | None = None,
    sort: Literal['updated', 'created', 'title'] = 'updated',
    limit: int = Query(default=100, ge=1, le=1000),
) -> ItemList:
    where = [Item.scope == auth.scope, Item.deleted_at.is_not(None) if trashed else Item.deleted_at.is_(None)]
    if kind:
        where.append(Item.kind == kind)
    if collection:
        where.append(Item.collection_id == collection)
    if unfiled:
        where.append(Item.collection_id.is_(None))
    if pinned is not None:
        where.append(Item.pinned.is_(pinned))
    if q and q.strip():
        pattern = like(q.strip())
        where.append(or_(Item.title.ilike(pattern, escape='\\'), Item.body.ilike(pattern, escape='\\')))
    # Pasted images belong to the note they were pasted into, so they stay out of the way by default.
    visible = or_(FileBlob.inline.is_(None), FileBlob.inline.is_(False)) if inline is None else FileBlob.inline.is_(inline)
    joined = select(Item).outerjoin(FileBlob).where(*where, visible)
    total = db.scalar(select(func.count()).select_from(joined.subquery()))
    rows = db.execute(
        joined.add_columns(func.substr(Item.body, 1, SNIPPET))
        .options(defer(Item.body))
        .order_by(Item.pinned.desc(), SORTS[sort])
        .limit(limit),
    ).unique().all()
    boards = [row[0].id for row in rows if row[0].kind == 'board']
    counts = dict(db.execute(
        select(Card.board_id, func.count()).where(Card.board_id.in_(boards)).group_by(Card.board_id),
    ).all()) if boards else {}
    return ItemList(
        items=[present(item, snippet or '', counts.get(item.id, 0) if item.kind == 'board' else None) for item, snippet in rows],
        total=total or 0,
    )


@router.get('/usage')
def usage(auth: Auth, db: ReadDb, settings: Config) -> Usage:
    used = db.scalar(select(func.coalesce(func.sum(FileBlob.size), 0)).join(Item).where(Item.scope == auth.scope)) or 0
    live = dict(db.execute(
        select(Item.kind, func.count()).outerjoin(FileBlob)
        .where(Item.scope == auth.scope, Item.deleted_at.is_(None), or_(FileBlob.inline.is_(None), FileBlob.inline.is_(False)))
        .group_by(Item.kind),
    ).all())
    trash = db.scalar(select(func.count()).select_from(Item).where(Item.scope == auth.scope, Item.deleted_at.is_not(None)))
    return Usage(
        used=used, quota=settings.quota_bytes, notes=live.get('note', 0), boards=live.get('board', 0),
        files=live.get('file', 0), trash=trash or 0,
    )


@router.patch('/items/{item_id}')
def patch_item(item_id: str, data: ItemPatch, auth: Auth, db: WriteDb) -> ItemOut:
    item = own_item(db, auth, item_id)
    if data.title is not None:
        item.title = data.title
        if item.file:
            item.file.filename = data.title[-255:]
    if 'collection_id' in data.model_fields_set:
        item.collection_id = check_collection(db, auth, data.collection_id)
    if data.pinned is not None:
        item.pinned = data.pinned
    if data.inline is not None:
        if not item.file:
            raise HTTPException(422, 'Only files can be embedded.')
        item.file.inline = data.inline
    touch(item)
    db.commit()
    return present(item)


@router.post('/items/bulk')
def bulk(data: Bulk, auth: Auth, db: WriteDb, settings: Config) -> dict:
    trashed_ok = data.action in ('restore', 'purge')
    items = [own_item(db, auth, item_id, trashed=trashed_ok) for item_id in data.ids]
    now = utcnow()
    if data.action == 'move':
        check_collection(db, auth, data.collection_id)
    for item in items:
        match data.action:
            case 'move':
                item.collection_id = data.collection_id
            case 'pin' | 'unpin':
                item.pinned = data.action == 'pin'
            case 'trash':
                item.deleted_at = now
            case 'restore':
                item.deleted_at = None
            case 'purge':
                purge(db, settings, item)
    db.commit()
    return {'count': len(items)}


@router.delete('/items/{item_id}', status_code=204)
def trash_item(item_id: str, auth: Auth, db: WriteDb) -> None:
    item = own_item(db, auth, item_id)
    item.deleted_at = utcnow()
    db.commit()


@router.delete('/trash', status_code=204)
def empty_trash(auth: Auth, db: WriteDb, settings: Config) -> None:
    for item in db.scalars(select(Item).where(Item.scope == auth.scope, Item.deleted_at.is_not(None))).unique():
        purge(db, settings, item)
    db.commit()


@router.post('/items/{item_id}/duplicate', status_code=201)
def duplicate(item_id: str, auth: Auth, db: WriteDb, settings: Config) -> ItemOut:
    item = own_item(db, auth, item_id)
    copy = Item(
        id=new_id(), scope=item.scope, kind=item.kind, title=f'{item.title[:290]} (copy)', body=item.body,
        collection_id=item.collection_id,
    )
    db.add(copy)
    db.flush()
    if item.file:
        scratch = settings.tmp_dir / new_id()
        shutil.copyfile(stored_path(settings, item.file.stored_name), scratch)
        db.add(FileBlob(
            item_id=copy.id, stored_name=keep_upload(settings, scratch), filename=item.file.filename,
            mime=item.file.mime, size=item.file.size, sha256=item.file.sha256, inline=False,
        ))
    if item.kind == 'board':
        columns = db.scalars(select(BoardColumn).where(BoardColumn.board_id == item.id)).all()
        for column in columns:
            new_column = BoardColumn(board_id=copy.id, title=column.title, color=column.color, position=column.position)
            db.add(new_column)
            db.flush()
            for card in db.scalars(select(Card).where(Card.column_id == column.id)):
                db.add(Card(
                    board_id=copy.id, column_id=new_column.id, title=card.title, body=card.body, labels=card.labels,
                    due_date=card.due_date, done=card.done, color=card.color, position=card.position,
                ))
    db.commit()
    db.refresh(copy)
    return present(copy)


def purge_expired_items(db: Session, settings: Settings) -> int:
    cutoff = utcnow() - timedelta(days=settings.trash_days)
    items = db.scalars(select(Item).where(Item.deleted_at.is_not(None), Item.deleted_at < cutoff)).unique().all()
    for item in items:
        purge(db, settings, item)
    return len(items)

