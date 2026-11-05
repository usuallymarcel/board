"""Read-only links to one item, for people without an account."""
import hashlib
import hmac
import secrets
import time
from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.db import utcnow
from app.models import Item, ShareLink
from app.routes.boards import board_columns
from app.routes.deps import Auth, Config, ReadDb, WriteDb, client_ip, own_item, throttle
from app.schemas import FileMeta, Grant, ShareIn, ShareInfo, ShareOut, SharedView, Unlock
from app.storage import file_response

router = APIRouter(prefix='/api', tags=['shares'])

GRANT_SECONDS = 3600
SCRYPT = {'n': 2 ** 14, 'r': 8, 'p': 1, 'dklen': 32}


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    return f'{salt.hex()}${hashlib.scrypt(password.encode(), salt=salt, **SCRYPT).hex()}'


def check_password(password: str, stored: str) -> bool:
    salt, digest = stored.split('$')
    return hmac.compare_digest(hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), **SCRYPT).hex(), digest)


def _sign(key: bytes, share_id: int, expires: int) -> str:
    return hmac.new(key, f'{share_id}:{expires}'.encode(), hashlib.sha256).hexdigest()


def make_grant(key: bytes, share_id: int) -> str:
    expires = int(time.time()) + GRANT_SECONDS
    return f'{expires}.{_sign(key, share_id, expires)}'


def grant_valid(key: bytes, share_id: int, grant: str | None) -> bool:
    if not grant or '.' not in grant:
        return False
    expires, signature = grant.split('.', 1)
    if not expires.isdigit() or int(expires) < time.time():
        return False
    return hmac.compare_digest(_sign(key, share_id, int(expires)), signature)


def share_out(share: ShareLink) -> ShareOut:
    return ShareOut(
        id=share.id, item_id=share.item_id, token=share.token, has_password=share.password_hash is not None,
        expires_at=share.expires_at, max_views=share.max_views, views=share.views, created_at=share.created_at,
    )


def live_share(db: Session, token: str) -> tuple[ShareLink, Item]:
    """404 for all the reasons a link can be dead, so a dead link reveals nothing."""
    share = db.scalar(select(ShareLink).where(ShareLink.token == token))
    if share is None:
        raise HTTPException(404, 'This link is no longer available.')
    item = db.get(Item, share.item_id)
    used_up = share.max_views is not None and share.views >= share.max_views
    expired = share.expires_at is not None and share.expires_at < utcnow()
    if item is None or item.deleted_at is not None or used_up or expired:
        raise HTTPException(404, 'This link is no longer available.')
    return share, item


def require_grant(request: Request, share: ShareLink, grant: str | None) -> None:
    if share.password_hash and not grant_valid(request.app.state.signing_key, share.id, grant):
        raise HTTPException(401, 'This link needs its password.')


def count_view(db: Session, share: ShareLink) -> None:
    db.execute(update(ShareLink).where(ShareLink.id == share.id).values(views=ShareLink.views + 1))
    db.commit()


@router.get('/shares')
def list_shares(item_id: str, auth: Auth, db: ReadDb) -> list[ShareOut]:
    item = own_item(db, auth, item_id)
    return [share_out(s) for s in db.scalars(select(ShareLink).where(ShareLink.item_id == item.id).order_by(ShareLink.id.desc()))]


@router.post('/shares', status_code=201)
def create_share(data: ShareIn, auth: Auth, db: WriteDb) -> ShareOut:
    item = own_item(db, auth, data.item_id)
    share = ShareLink(
        scope=auth.scope, item_id=item.id, token=secrets.token_urlsafe(24),
        password_hash=hash_password(data.password) if data.password else None,
        expires_at=utcnow() + timedelta(hours=data.expires_in_hours) if data.expires_in_hours else None,
        max_views=data.max_views,
    )
    db.add(share)
    db.commit()
    return share_out(share)


@router.delete('/shares/{share_id}', status_code=204)
def delete_share(share_id: int, auth: Auth, db: WriteDb) -> None:
    share = db.get(ShareLink, share_id)
    if share is None or share.scope != auth.scope:
        raise HTTPException(404, 'Not found.')
    db.delete(share)
    db.commit()


@router.get('/public/shares/{token}/info')
def share_info(token: str, db: ReadDb) -> ShareInfo:
    share, item = live_share(db, token)
    return ShareInfo(title=item.title, kind=item.kind, needs_password=share.password_hash is not None)


@router.post('/public/shares/{token}/unlock')
def unlock_share(token: str, data: Unlock, request: Request, db: ReadDb) -> Grant:
    throttle(request, 'public_limiter', f'unlock:{client_ip(request)}')
    share, _ = live_share(db, token)
    if not share.password_hash or not check_password(data.password, share.password_hash):
        raise HTTPException(403, 'That password is not right.')
    return Grant(grant=make_grant(request.app.state.signing_key, share.id))


@router.get('/public/shares/{token}')
def shared_view(token: str, request: Request, db: WriteDb, grant: str | None = None) -> SharedView:
    share, item = live_share(db, token)
    require_grant(request, share, grant)
    view = SharedView(
        kind=item.kind, title=item.title, updated_at=item.updated_at, body=item.body,
        file=FileMeta.model_validate(item.file) if item.file else None,
        columns=board_columns(db, item.id) if item.kind == 'board' else None,
    )
    # Fetching a file's details is not a view of it; the download below is.
    if item.kind != 'file':
        count_view(db, share)
    return view


@router.get('/public/shares/{token}/file')
def shared_file(token: str, request: Request, db: WriteDb, settings: Config, grant: str | None = None, download: bool = False) -> FileResponse:
    share, item = live_share(db, token)
    require_grant(request, share, grant)
    if item.file is None:
        raise HTTPException(404, 'Not found.')
    # Video players ask for many ranges; only the first request counts.
    if request.headers.get('range', 'bytes=0-').startswith('bytes=0-'):
        count_view(db, share)
    blob = item.file
    return file_response(settings, blob.stored_name, blob.filename, blob.mime, download=download)
