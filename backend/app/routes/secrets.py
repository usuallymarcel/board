"""One-time secret links. The browser encrypts before anything is sent and the key lives in the URL
fragment, which browsers never transmit, so this server cannot read what it stores."""
import hmac
from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import utcnow
from app.models import Secret
from app.routes.deps import Auth, ReadDb, WriteDb, client_ip, throttle
from app.schemas import SecretIn, SecretInfo, SecretOut, SecretPayload, SecretReveal
from app.storage import new_id

router = APIRouter(prefix='/api', tags=['secrets'])

MAX_FAILED_PASSPHRASES = 10
GONE = 'This secret has been viewed, has expired, or never existed.'


def is_live(secret: Secret) -> bool:
    return secret.ciphertext is not None and secret.expires_at > utcnow()


def present(secret: Secret) -> SecretOut:
    return SecretOut(
        id=secret.id, label=secret.label, max_views=secret.max_views, views=secret.views,
        expires_at=secret.expires_at, created_at=secret.created_at, active=is_live(secret),
        has_passphrase=secret.verifier is not None,
    )


@router.get('/secrets')
def list_secrets(auth: Auth, db: ReadDb) -> list[SecretOut]:
    rows = db.scalars(select(Secret).where(Secret.scope == auth.scope).order_by(Secret.created_at.desc()))
    return [present(row) for row in rows]


@router.post('/secrets', status_code=201)
def create_secret(data: SecretIn, auth: Auth, db: WriteDb) -> SecretOut:
    if bool(data.salt) != bool(data.verifier):
        raise HTTPException(422, 'A passphrase needs both salt and verifier.')
    secret = Secret(
        id=new_id(), scope=auth.scope, label=data.label.strip(), ciphertext=data.ciphertext, iv=data.iv,
        salt=data.salt, verifier=data.verifier, max_views=data.max_views,
        expires_at=utcnow() + timedelta(hours=data.expires_in_hours),
    )
    db.add(secret)
    db.commit()
    return present(secret)


@router.delete('/secrets/{secret_id}', status_code=204)
def delete_secret(secret_id: str, auth: Auth, db: WriteDb) -> None:
    secret = db.get(Secret, secret_id)
    if secret is None or secret.scope != auth.scope:
        raise HTTPException(404, 'Not found.')
    db.delete(secret)
    db.commit()


@router.get('/public/secrets/{secret_id}')
def secret_info(secret_id: str, db: ReadDb) -> SecretInfo:
    """Costs no view, so a chat app unfurling the link cannot burn it."""
    secret = db.get(Secret, secret_id)
    if secret is None or not is_live(secret):
        raise HTTPException(404, GONE)
    return SecretInfo(
        has_passphrase=secret.verifier is not None, salt=secret.salt,
        views_left=secret.max_views - secret.views, expires_at=secret.expires_at,
    )


@router.post('/public/secrets/{secret_id}/reveal')
def reveal_secret(secret_id: str, data: SecretReveal, request: Request, db: WriteDb) -> SecretPayload:
    throttle(request, 'public_limiter', f'reveal:{client_ip(request)}')
    # The write session holds SQLite's write lock from here on, so two simultaneous reveals of a
    # one-view secret cannot both succeed.
    secret = db.get(Secret, secret_id)
    if secret is None or not is_live(secret):
        raise HTTPException(404, GONE)
    if secret.verifier and not hmac.compare_digest(secret.verifier, data.verifier or ''):
        secret.failed_attempts += 1
        if secret.failed_attempts >= MAX_FAILED_PASSPHRASES:
            secret.ciphertext = None
        db.commit()
        raise HTTPException(403, 'That passphrase is not right.')
    payload = SecretPayload(ciphertext=secret.ciphertext, iv=secret.iv, views_left=secret.max_views - secret.views - 1)
    secret.views += 1
    if secret.views >= secret.max_views:
        secret.ciphertext = None
    db.commit()
    return payload


def purge_expired_secrets(db: Session) -> int:
    """Ciphertext goes at expiry. The row stays a month so its owner can see what happened to it."""
    now = utcnow()
    expired = db.scalars(select(Secret).where(Secret.expires_at < now, Secret.ciphertext.is_not(None))).all()
    for secret in expired:
        secret.ciphertext = None
    removed = db.execute(delete(Secret).where(Secret.expires_at < now - timedelta(days=30)))
    return len(expired) + removed.rowcount
