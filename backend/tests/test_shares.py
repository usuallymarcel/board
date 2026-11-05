from datetime import timedelta

from app.db import utcnow
from app.models import ShareLink


def share(h, item_id, **options):
    response = h.client.post('/api/shares', json={'item_id': item_id, **options})
    assert response.status_code == 201, response.text
    return response.json()


def test_note_share_is_public_and_revocable(scoped, alice):
    c = scoped.client
    n = c.post('/api/notes', json={'title': 'Shared', 'body': '# hi'}, headers=alice).json()
    s = c.post('/api/shares', json={'item_id': n['id']}, headers=alice).json()
    assert c.get(f'/api/public/shares/{s["token"]}/info').json() == {'title': 'Shared', 'kind': 'note', 'needs_password': False}
    assert c.get(f'/api/public/shares/{s["token"]}').json()['body'] == '# hi'
    # Survives an outage: it is a public page.
    scoped.users.mode = 'down'
    scoped.refresh_status()
    assert c.get(f'/api/public/shares/{s["token"]}').status_code == 200
    scoped.users.mode = 'ok'
    scoped.refresh_status()
    assert c.delete(f'/api/shares/{s["id"]}', headers=alice).status_code == 204
    assert c.get(f'/api/public/shares/{s["token"]}').status_code == 404


def test_board_share(local):
    board = local.client.post('/api/boards', json={'title': 'B'}).json()
    s = share(local, board['id'])
    view = local.client.get(f'/api/public/shares/{s["token"]}').json()
    assert view['kind'] == 'board' and len(view['columns']) == 3


def test_password_protected_file(local):
    f = local.upload(b'payload', 'x.bin').json()
    s = share(local, f['id'], password='hunter22')
    url = f'/api/public/shares/{s["token"]}'
    assert s['has_password'] and 'password_hash' not in s
    assert local.client.get(url).status_code == 401
    assert local.client.get(f'{url}/file').status_code == 401
    assert local.client.post(f'{url}/unlock', json={'password': 'wrong'}).status_code == 403
    grant = local.client.post(f'{url}/unlock', json={'password': 'hunter22'}).json()['grant']
    assert local.client.get(url, params={'grant': grant}).json()['file']['filename'] == 'x.bin'
    assert local.client.get(f'{url}/file', params={'grant': grant}).content == b'payload'
    assert local.client.get(f'{url}/file', params={'grant': grant + 'x'}).status_code == 401
    forged = '9999999999.' + grant.split('.')[1]
    assert local.client.get(f'{url}/file', params={'grant': forged}).status_code == 401


def test_grant_is_for_one_link(local):
    f = local.upload(b'p').json()
    one, two = share(local, f['id'], password='a'), share(local, f['id'], password='b')
    grant = local.client.post(f'/api/public/shares/{one["token"]}/unlock', json={'password': 'a'}).json()['grant']
    assert local.client.get(f'/api/public/shares/{two["token"]}', params={'grant': grant}).status_code == 401


def test_view_limit_and_expiry(local):
    f = local.upload(b'p').json()
    s = share(local, f['id'], max_views=2)
    url = f'/api/public/shares/{s["token"]}/file'
    assert local.client.get(url).status_code == 200
    assert local.client.get(url).status_code == 200
    assert local.client.get(url).status_code == 404
    e = share(local, f['id'], expires_in_hours=1)
    assert local.client.get(f'/api/public/shares/{e["token"]}').status_code == 200
    with local.app.state.db.write() as db:
        db.get(ShareLink, e['id']).expires_at = utcnow() - timedelta(minutes=1)
        db.commit()
    assert local.client.get(f'/api/public/shares/{e["token"]}').status_code == 404


def test_trashing_kills_links(local):
    n = local.client.post('/api/notes', json={}).json()
    s = share(local, n['id'])
    local.client.delete(f'/api/items/{n["id"]}')
    assert local.client.get(f'/api/public/shares/{s["token"]}/info').status_code == 404


def test_unlock_is_rate_limited(local):
    n = local.client.post('/api/notes', json={}).json()
    s = share(local, n['id'], password='a')
    codes = [local.client.post(f'/api/public/shares/{s["token"]}/unlock', json={'password': 'x'}).status_code for _ in range(31)]
    assert codes[-1] == 429
