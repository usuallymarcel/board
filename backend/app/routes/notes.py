from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Response

from app.models import Item
from app.routes.deps import Auth, ReadDb, WriteDb, check_collection, own_item, touch
from app.routes.items import present
from app.schemas import NoteIn, NoteOut, NotePatch
from app.storage import new_id

router = APIRouter(prefix='/api/notes', tags=['notes'])


def note_out(item: Item) -> NoteOut:
    return NoteOut(**present(item).model_dump(), body=item.body)


@router.post('', status_code=201)
def create_note(data: NoteIn, auth: Auth, db: WriteDb) -> NoteOut:
    item = Item(
        id=new_id(), scope=auth.scope, kind='note', title=data.title, body=data.body,
        collection_id=check_collection(db, auth, data.collection_id),
    )
    db.add(item)
    db.commit()
    return note_out(item)


@router.get('/{item_id}')
def get_note(item_id: str, auth: Auth, db: ReadDb) -> NoteOut:
    return note_out(own_item(db, auth, item_id, 'note'))


@router.patch('/{item_id}')
def patch_note(item_id: str, data: NotePatch, auth: Auth, db: WriteDb) -> NoteOut:
    item = own_item(db, auth, item_id, 'note')
    if data.version is not None and data.version != item.version:
        raise HTTPException(409, 'This note changed somewhere else.')
    if data.title is not None:
        item.title = data.title
    if data.body is not None:
        item.body = data.body
    item.version += 1
    touch(item)
    db.commit()
    return note_out(item)


@router.get('/{item_id}/export')
def export_note(item_id: str, auth: Auth, db: ReadDb) -> Response:
    item = own_item(db, auth, item_id, 'note')
    name = quote(f'{item.title}.md')
    return Response(
        item.body,
        media_type='application/octet-stream',
        headers={'Content-Disposition': f"attachment; filename*=UTF-8''{name}"},
    )
