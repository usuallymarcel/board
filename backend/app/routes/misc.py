"""Health, preferences and search."""
from fastapi import APIRouter, HTTPException, Query, Request
from sqlalchemy import or_, select, text
from sqlalchemy.exc import SQLAlchemyError

from app.db import utcnow
from app.models import Card, Collection, Item, Preference
from app.routes.deps import Auth, ReadDb, WriteDb, like
from app.schemas import PreferencesEnvelope, PreferencesIn, SearchHit

router = APIRouter(prefix='/api', tags=['misc'])

MAX_HITS = 30


@router.get('/healthz')
def healthz():
    return {'status': 'ok'}


@router.get('/readyz')
async def readyz(request: Request):
    """Ready to serve. users-api is reported, not required: public pages work without it."""
    try:
        with request.app.state.db.read() as db:
            db.execute(text('SELECT 1'))
    except SQLAlchemyError:
        raise HTTPException(503, 'Database unavailable.') from None
    return {'status': 'ok', 'users_api': await request.app.state.auth.status()}


@router.get('/preferences')
def get_preferences(auth: Auth, db: ReadDb) -> PreferencesEnvelope:
    row = db.get(Preference, auth.scope)
    return PreferencesEnvelope(data=row.data if row else None, updated_at=row.updated_at if row else None)


@router.put('/preferences')
def put_preferences(data: PreferencesIn, auth: Auth, db: WriteDb) -> PreferencesEnvelope:
    row = db.get(Preference, auth.scope)
    if row is None:
        row = Preference(scope=auth.scope)
        db.add(row)
    row.data = data.data
    row.updated_at = utcnow()
    db.commit()
    return PreferencesEnvelope(data=row.data, updated_at=row.updated_at)


def _snippet(body: str, term: str) -> str:
    at = body.lower().find(term.lower())
    if at < 0:
        return body[:120]
    start = max(0, at - 40)
    return ('...' if start else '') + body[start:at + 100]


@router.get('/search')
def search(auth: Auth, db: ReadDb, q: str = Query(min_length=1, max_length=200)) -> list[SearchHit]:
    term = q.strip()
    if not term:
        return []
    pattern = like(term)
    hits: list[SearchHit] = []
    collections = db.scalars(
        select(Collection).where(Collection.scope == auth.scope, Collection.name.ilike(pattern, escape='\\')).limit(8),
    )
    hits += [SearchHit(type='collection', id=c.id, title=c.name) for c in collections]
    items = db.scalars(
        select(Item)
        .where(
            Item.scope == auth.scope, Item.deleted_at.is_(None),
            or_(Item.title.ilike(pattern, escape='\\'), Item.body.ilike(pattern, escape='\\')),
        )
        .order_by(Item.updated_at.desc())
        .limit(MAX_HITS),
    ).unique()
    hits += [SearchHit(type=i.kind, id=i.id, title=i.title, snippet=_snippet(i.body, term)) for i in items]
    cards = db.scalars(
        select(Card).join(Item, Card.board_id == Item.id)
        .where(
            Item.scope == auth.scope, Item.deleted_at.is_(None),
            or_(Card.title.ilike(pattern, escape='\\'), Card.body.ilike(pattern, escape='\\')),
        )
        .limit(MAX_HITS),
    )
    hits += [SearchHit(type='card', id=str(c.id), title=c.title, snippet=_snippet(c.body, term), board_id=c.board_id) for c in cards]
    return hits
