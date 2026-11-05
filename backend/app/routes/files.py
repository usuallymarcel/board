from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from sqlalchemy import func, select

from app.auth import AuthContext, require_access
from app.models import Collection, FileBlob, Item
from app.routes.deps import Auth, Config, ReadDb, own_item
from app.routes.items import present
from app.schemas import ItemOut
from app.storage import (
    UploadRejected, file_response, keep_upload, new_id, receive_upload, strip_metadata,
)

router = APIRouter(prefix='/api', tags=['files'])


def _save(request: Request, auth: AuthContext, upload, inline: bool, collection_id: str | None) -> ItemOut:
    settings = request.app.state.settings
    with request.app.state.db.write() as db:
        if collection_id:
            collection = db.get(Collection, collection_id)
            if collection is None or collection.scope != auth.scope:
                raise HTTPException(404, 'Collection not found.')
        used = db.scalar(select(func.coalesce(func.sum(FileBlob.size), 0)).join(Item).where(Item.scope == auth.scope)) or 0
        if used + upload.size > settings.quota_bytes:
            raise HTTPException(413, 'Your storage is full. Empty the trash or delete some files.')
        stored_name = keep_upload(settings, upload.path)
        item = Item(id=new_id(), scope=auth.scope, kind='file', title=upload.filename, collection_id=collection_id or None)
        item.file = FileBlob(
            stored_name=stored_name, filename=upload.filename, mime=upload.mime, size=upload.size,
            sha256=upload.sha256, inline=inline,
        )
        db.add(item)
        db.commit()
        return present(item)


@router.post('/files', status_code=201)
async def upload_file(request: Request) -> ItemOut:
    # Resolved by hand: nothing may read the body before the streaming parser does.
    auth = await require_access(await request.app.state.auth.context(request))
    settings = request.app.state.settings
    try:
        upload = await receive_upload(request, settings)
        inline = upload.fields.get('inline') == 'true'
        try:
            if inline:
                cleaned = await run_in_threadpool(strip_metadata, upload.path, upload.mime)
                if cleaned:
                    upload.size, upload.sha256 = cleaned
            return await run_in_threadpool(_save, request, auth, upload, inline, upload.fields.get('collection_id'))
        finally:
            upload.path.unlink(missing_ok=True)
    except UploadRejected as rejected:
        raise HTTPException(rejected.status, rejected.message) from None


@router.get('/files/{item_id}/raw')
def raw_file(item_id: str, auth: Auth, db: ReadDb, settings: Config, download: bool = False) -> FileResponse:
    item = own_item(db, auth, item_id, 'file')
    blob = item.file
    return file_response(settings, blob.stored_name, blob.filename, blob.mime, download=download)


@router.get('/media/{item_id}/{name:path}')
def media(item_id: str, name: str, db: ReadDb, settings: Config) -> FileResponse:
    """Files embedded in markdown. Public to anyone with the 128-bit id, the same model as an
    attachment on a code host, so a post or shared note can show its images to anyone."""
    item = db.get(Item, item_id)
    if item is None or item.file is None or not item.file.inline or item.deleted_at is not None:
        raise HTTPException(404, 'Not found.')
    blob = item.file
    return file_response(settings, blob.stored_name, blob.filename, blob.mime, download=False)
