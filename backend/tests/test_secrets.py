from datetime import timedelta

from app.db import utcnow
from app.main import run_maintenance
from app.models import Secret

BLOB = {'ciphertext': 'abcd', 'iv': 'aaaaaaaaaaaaaaaa'}
VERIFIER = 'a' * 64


def make(h, headers=None, **options):
    response = h.client.post('/api/secrets', json={**BLOB, **options}, headers=headers or {})
    assert response.status_code == 201, response.text
    return response.json()


def test_create_needs_login_but_reveal_does_not(scoped, alice):
    assert scoped.client.post('/api/secrets', json=BLOB).status_code == 401
    s = make(scoped, alice)
    assert scoped.client.get(f'/api/public/secrets/{s["id"]}').json()['views_left'] == 1
    assert scoped.client.post(f'/api/public/secrets/{s["id"]}/reveal', json={}).json()['ciphertext'] == 'abcd'


def test_burn_after_reading(local):
    s = make(local)
    url = f'/api/public/secrets/{s["id"]}'
    for _ in range(3):  # Link previews are free.
        assert local.client.get(url).status_code == 200
    assert local.client.post(f'{url}/reveal', json={}).status_code == 200
    assert local.client.post(f'{url}/reveal', json={}).status_code == 404
    assert local.client.get(url).status_code == 404
    with local.app.state.db.read() as db:
        assert db.get(Secret, s['id']).ciphertext is None
    assert local.client.get('/api/secrets').json()[0]['active'] is False


def test_multiple_views(local):
    s = make(local, max_views=2)
    first = local.client.post(f'/api/public/secrets/{s["id"]}/reveal', json={}).json()
    assert first['views_left'] == 1
    assert local.client.post(f'/api/public/secrets/{s["id"]}/reveal', json={}).status_code == 200
    assert local.client.post(f'/api/public/secrets/{s["id"]}/reveal', json={}).status_code == 404


def test_wrong_passphrase_costs_no_view_then_burns(local):
    s = make(local, salt='c2FsdA==', verifier=VERIFIER)
    url = f'/api/public/secrets/{s["id"]}'
    assert local.client.get(url).json()['has_passphrase']
    assert local.client.post(f'{url}/reveal', json={}).status_code == 403
    assert local.client.post(f'{url}/reveal', json={'verifier': 'b' * 64}).status_code == 403
    assert local.client.post(f'{url}/reveal', json={'verifier': VERIFIER}).status_code == 200
    s2 = make(local, salt='c2FsdA==', verifier=VERIFIER)
    url2 = f'/api/public/secrets/{s2["id"]}'
    for _ in range(10):
        assert local.client.post(f'{url2}/reveal', json={'verifier': 'b' * 64}).status_code == 403
    assert local.client.post(f'{url2}/reveal', json={'verifier': VERIFIER}).status_code == 404


def test_expiry_and_cleanup(local):
    s = make(local)
    gone = make(local)
    with local.app.state.db.write() as db:
        db.get(Secret, s['id']).expires_at = utcnow() - timedelta(minutes=1)
        db.get(Secret, gone['id']).expires_at = utcnow() - timedelta(days=31)
        db.commit()
    assert local.client.get(f'/api/public/secrets/{s["id"]}').status_code == 404
    assert local.client.post(f'/api/public/secrets/{s["id"]}/reveal', json={}).status_code == 404
    run_maintenance(local.app)
    with local.app.state.db.read() as db:
        assert db.get(Secret, s['id']).ciphertext is None
        assert db.get(Secret, gone['id']) is None


def test_owner_list_never_contains_ciphertext(scoped, alice, bob):
    make(scoped, alice, label='wifi')
    listed = scoped.client.get('/api/secrets', headers=alice).json()
    assert listed[0]['label'] == 'wifi' and 'ciphertext' not in listed[0]
    assert scoped.client.get('/api/secrets', headers=bob).json() == []
    assert scoped.client.delete(f'/api/secrets/{listed[0]["id"]}', headers=bob).status_code == 404


def test_revoke(local):
    s = make(local)
    assert local.client.delete(f'/api/secrets/{s["id"]}').status_code == 204
    assert local.client.get(f'/api/public/secrets/{s["id"]}').status_code == 404


def test_reveal_rate_limited(local):
    codes = [local.client.post(f'/api/public/secrets/{"0" * 32}/reveal', json={}).status_code for _ in range(31)]
    assert codes[0] == 404 and codes[-1] == 429


def test_partial_passphrase_rejected(local):
    assert local.client.post('/api/secrets', json={**BLOB, 'verifier': VERIFIER}).status_code == 422
