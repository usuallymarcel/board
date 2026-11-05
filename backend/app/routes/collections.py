from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select, update

from app.models import Collection, Item
from app.routes.deps import Auth, ReadDb, WriteDb, check_collection, own_collection
from app.schemas import CollectionIn, CollectionOut, CollectionPatch, Reorder
from app.storage import new_id

router = APIRouter(prefix='/api/collections', tags=['collections'])


def present(collection: Collection, count: int = 0) -> CollectionOut:
    out = CollectionOut.model_validate(collection)
    out.item_count = count
    return out


@router.get('')
def list_collections(auth: Auth, db: ReadDb) -> list[CollectionOut]:
    counts = dict(db.execute(
        select(Item.collection_id, func.count())
        .where(Item.scope == auth.scope, Item.deleted_at.is_(None), Item.collection_id.is_not(None))
        .group_by(Item.collection_id),
    ).all())
    rows = db.scalars(
        select(Collection).where(Collection.scope == auth.scope).order_by(Collection.position, Collection.name),
    ).all()
    return [present(row, counts.get(row.id, 0)) for row in rows]


@router.post('', status_code=201)
def create_collection(data: CollectionIn, auth: Auth, db: WriteDb) -> CollectionOut:
    check_collection(db, auth, data.parent_id)
    last = db.scalar(
        select(func.max(Collection.position)).where(Collection.scope == auth.scope, Collection.parent_id == data.parent_id),
    )
    collection = Collection(
        id=new_id(), scope=auth.scope, name=data.name, parent_id=data.parent_id,
        color=data.color, icon=data.icon, position=(last or 0) + 1,
    )
    db.add(collection)
    db.commit()
    return present(collection)


@router.patch('/{collection_id}')
def patch_collection(collection_id: str, data: CollectionPatch, auth: Auth, db: WriteDb) -> CollectionOut:
    collection = own_collection(db, auth, collection_id)
    sent = data.model_fields_set
    if 'parent_id' in sent:
        check_collection(db, auth, data.parent_id)
        ancestor = data.parent_id
        while ancestor is not None:
            if ancestor == collection.id:
                raise HTTPException(409, 'A collection cannot go inside itself.')
            ancestor = db.get(Collection, ancestor).parent_id
        collection.parent_id = data.parent_id
    if data.name is not None:
        collection.name = data.name
    if 'color' in sent:
        collection.color = data.color
    if 'icon' in sent:
        collection.icon = data.icon or None
    db.commit()
    return present(collection)


@router.post('/reorder', status_code=204)
def reorder(data: Reorder, auth: Auth, db: WriteDb) -> None:
    check_collection(db, auth, data.parent_id)
    for position, collection_id in enumerate(data.ids):
        collection = own_collection(db, auth, collection_id)
        if collection.id == data.parent_id:
            raise HTTPException(409, 'A collection cannot go inside itself.')
        collection.parent_id = data.parent_id
        collection.position = position
    db.commit()


@router.delete('/{collection_id}', status_code=204)
def delete_collection(collection_id: str, auth: Auth, db: WriteDb) -> None:
    """Deleting a grouping never deletes what is in it: contents move up one level."""
    collection = own_collection(db, auth, collection_id)
    parent = collection.parent_id
    db.execute(update(Item).where(Item.collection_id == collection.id).values(collection_id=parent))
    db.execute(update(Collection).where(Collection.parent_id == collection.id).values(parent_id=parent))
    db.delete(collection)
    db.commit()
