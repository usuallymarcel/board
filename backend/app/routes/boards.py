from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import utcnow
from app.models import BoardColumn, Card, Item
from app.routes.deps import Auth, ReadDb, WriteDb, check_collection, own_card, own_column, own_item, place, touch
from app.routes.items import present
from app.schemas import (
    BoardIn, BoardOut, BoardPatch, CardIn, CardOut, CardPatch, ColumnIn, ColumnOut, ColumnPatch, Move, UpcomingCard,
)
from app.storage import new_id

router = APIRouter(prefix='/api', tags=['boards'])


def columns_of(db: Session, board_id: str) -> list[BoardColumn]:
    return list(db.scalars(select(BoardColumn).where(BoardColumn.board_id == board_id).order_by(BoardColumn.position, BoardColumn.id)))


def cards_of(db: Session, column_id: int) -> list[Card]:
    return list(db.scalars(select(Card).where(Card.column_id == column_id).order_by(Card.position, Card.id)))


def board_columns(db: Session, board_id: str) -> list[ColumnOut]:
    cards = db.scalars(select(Card).where(Card.board_id == board_id).order_by(Card.position, Card.id)).all()
    columns = []
    for column in columns_of(db, board_id):
        out = ColumnOut.model_validate(column)
        out.cards = [CardOut.model_validate(card) for card in cards if card.column_id == column.id]
        columns.append(out)
    return columns


def board_out(db: Session, item: Item) -> BoardOut:
    return BoardOut(**present(item).model_dump(), body=item.body, columns=board_columns(db, item.id))


@router.post('/boards', status_code=201)
def create_board(data: BoardIn, auth: Auth, db: WriteDb) -> BoardOut:
    item = Item(
        id=new_id(), scope=auth.scope, kind='board', title=data.title,
        collection_id=check_collection(db, auth, data.collection_id),
    )
    db.add(item)
    db.flush()
    for position, title in enumerate(data.columns):
        db.add(BoardColumn(board_id=item.id, title=title, position=position))
    db.commit()
    return board_out(db, item)


@router.get('/boards/{item_id}')
def get_board(item_id: str, auth: Auth, db: ReadDb) -> BoardOut:
    return board_out(db, own_item(db, auth, item_id, 'board'))


@router.patch('/boards/{item_id}')
def patch_board(item_id: str, data: BoardPatch, auth: Auth, db: WriteDb) -> BoardOut:
    item = own_item(db, auth, item_id, 'board')
    if data.title is not None:
        item.title = data.title
    if data.body is not None:
        item.body = data.body
    touch(item)
    db.commit()
    return board_out(db, item)


@router.post('/boards/{item_id}/columns', status_code=201)
def create_column(item_id: str, data: ColumnIn, auth: Auth, db: WriteDb) -> ColumnOut:
    item = own_item(db, auth, item_id, 'board')
    column = BoardColumn(board_id=item.id, title=data.title, color=data.color, position=len(columns_of(db, item.id)))
    db.add(column)
    touch(item)
    db.commit()
    return ColumnOut.model_validate(column)


@router.patch('/columns/{column_id}')
def patch_column(column_id: int, data: ColumnPatch, auth: Auth, db: WriteDb) -> ColumnOut:
    column, item = own_column(db, auth, column_id)
    if data.title is not None:
        column.title = data.title
    if 'color' in data.model_fields_set:
        column.color = data.color
    touch(item)
    db.commit()
    return ColumnOut.model_validate(column)


@router.post('/columns/{column_id}/move', status_code=204)
def move_column(column_id: int, data: Move, auth: Auth, db: WriteDb) -> None:
    column, item = own_column(db, auth, column_id)
    place(columns_of(db, item.id), column, data.index)
    touch(item)
    db.commit()


@router.delete('/columns/{column_id}', status_code=204)
def delete_column(column_id: int, auth: Auth, db: WriteDb, move_to: int | None = Query(default=None)) -> None:
    """Cards go to move_to when given, otherwise with the column."""
    column, item = own_column(db, auth, column_id)
    if move_to is not None:
        target, target_board = own_column(db, auth, move_to)
        if target_board.id != item.id or target.id == column.id:
            raise HTTPException(422, 'Move cards to another column on this board.')
        offset = len(cards_of(db, target.id))
        for position, card in enumerate(cards_of(db, column.id)):
            card.column_id = target.id
            card.position = offset + position
        db.flush()
    db.delete(column)
    touch(item)
    db.commit()


@router.post('/boards/{item_id}/cards', status_code=201)
def create_card(item_id: str, data: CardIn, auth: Auth, db: WriteDb) -> CardOut:
    item = own_item(db, auth, item_id, 'board')
    column, board = own_column(db, auth, data.column_id)
    if board.id != item.id:
        raise HTTPException(404, 'Not found.')
    siblings = cards_of(db, column.id)
    card = Card(board_id=item.id, column_id=column.id, title=data.title, body=data.body, labels=[], position=len(siblings))
    db.add(card)
    db.flush()
    if data.top:
        place([*siblings, card], card, 0)
    touch(item)
    db.commit()
    return CardOut.model_validate(card)


@router.patch('/cards/{card_id}')
def patch_card(card_id: int, data: CardPatch, auth: Auth, db: WriteDb) -> CardOut:
    card, item = own_card(db, auth, card_id)
    sent = data.model_fields_set
    for name in ('title', 'body', 'labels', 'done'):
        value = getattr(data, name)
        if value is not None:
            setattr(card, name, value)
    if 'due_date' in sent:
        card.due_date = data.due_date
    if 'color' in sent:
        card.color = data.color
    card.updated_at = utcnow()
    touch(item)
    db.commit()
    return CardOut.model_validate(card)


@router.post('/cards/{card_id}/move', status_code=204)
def move_card(card_id: int, data: Move, auth: Auth, db: WriteDb) -> None:
    card, item = own_card(db, auth, card_id)
    column_id = data.column_id if data.column_id is not None else card.column_id
    column, board = own_column(db, auth, column_id)
    if board.id != item.id:
        raise HTTPException(422, 'Cards stay on their own board.')
    siblings = cards_of(db, column.id)
    if card.column_id != column.id:
        card.column_id = column.id
    place(siblings, card, data.index)
    touch(item)
    db.commit()


@router.delete('/cards/{card_id}', status_code=204)
def delete_card(card_id: int, auth: Auth, db: WriteDb) -> None:
    card, item = own_card(db, auth, card_id)
    db.delete(card)
    touch(item)
    db.commit()


@router.get('/cards/upcoming')
def upcoming(auth: Auth, db: ReadDb, limit: int = Query(default=20, ge=1, le=100)) -> list[UpcomingCard]:
    """Cards with a due date, soonest first, for the home page."""
    rows = db.execute(
        select(Card, Item.title, BoardColumn.title)
        .join(Item, Card.board_id == Item.id)
        .join(BoardColumn, Card.column_id == BoardColumn.id)
        .where(Item.scope == auth.scope, Item.deleted_at.is_(None), Card.done.is_(False), Card.due_date.is_not(None))
        .order_by(Card.due_date)
        .limit(limit),
    ).all()
    return [
        UpcomingCard(
            id=card.id, board_id=card.board_id, board_title=board_title, column_title=column_title,
            title=card.title, due_date=card.due_date, done=card.done,
        )
        for card, board_title, column_title in rows
    ]

