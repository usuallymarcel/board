from datetime import timedelta

import pytest

from app.db import utcnow
from app.main import run_maintenance
from app.models import Item


def note(h, headers, **body):
    response = h.client.post('/api/notes', json={'title': 'n', **body}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def collection(h, headers, name='c', **body):
    return h.client.post('/api/collections', json={'name': name, **body}, headers=headers).json()


def test_scope_isolation_everywhere(scoped, alice, bob):
    c = scoped.client
    n = note(scoped, alice, title='secret plans')
    col = collection(scoped, alice)
    board = c.post('/api/boards', json={}, headers=alice).json()
    upload = scoped.upload(headers=alice).json()
    share = c.post('/api/shares', json={'item_id': n['id']}, headers=alice).json()
    first_column = board['columns'][0]['id']
    card = c.post(f'/api/boards/{board["id"]}/cards', json={'column_id': first_column, 'title': 't'}, headers=alice).json()

    assert c.get('/api/items', headers=bob).json()['items'] == []
    assert c.get('/api/collections', headers=bob).json() == []
    assert c.get('/api/search', params={'q': 'secret'}, headers=bob).json() == []
    for method, url, kwargs in [
        ('GET', f'/api/notes/{n["id"]}', {}),
        ('PATCH', f'/api/notes/{n["id"]}', {'json': {'body': 'x'}}),
        ('GET', f'/api/notes/{n["id"]}/export', {}),
        ('PATCH', f'/api/items/{n["id"]}', {'json': {'title': 'x'}}),
        ('DELETE', f'/api/items/{n["id"]}', {}),
        ('POST', f'/api/items/{n["id"]}/duplicate', {}),
        ('POST', '/api/items/bulk', {'json': {'ids': [n['id']], 'action': 'purge'}}),
        ('GET', f'/api/boards/{board["id"]}', {}),
        ('POST', f'/api/boards/{board["id"]}/cards', {'json': {'column_id': first_column, 'title': 't'}}),
        ('PATCH', f'/api/cards/{card["id"]}', {'json': {'title': 'x'}}),
        ('POST', f'/api/cards/{card["id"]}/move', {'json': {'index': 0}}),
        ('DELETE', f'/api/cards/{card["id"]}', {}),
        ('PATCH', f'/api/columns/{first_column}', {'json': {'title': 'x'}}),
        ('DELETE', f'/api/columns/{first_column}', {}),
        ('GET', f'/api/files/{upload["id"]}/raw', {}),
        ('GET', f'/api/shares?item_id={n["id"]}', {}),
        ('DELETE', f'/api/shares/{share["id"]}', {}),
        ('POST', '/api/shares', {'json': {'item_id': n['id']}}),
        ('PATCH', f'/api/collections/{col["id"]}', {'json': {'name': 'x'}}),
        ('DELETE', f'/api/collections/{col["id"]}', {}),
    ]:
        assert c.request(method, url, headers=bob, **kwargs).status_code == 404, url
    # Nor can bob file things into alice's collection.
    assert c.post('/api/notes', json={'collection_id': col['id']}, headers=bob).status_code == 404


def test_note_conflict(local):
    n = note(local, {}, body='one')
    first = local.client.patch(f'/api/notes/{n["id"]}', json={'body': 'two', 'version': n['version']})
    assert first.json()['version'] == n['version'] + 1
    assert local.client.patch(f'/api/notes/{n["id"]}', json={'body': 'three', 'version': n['version']}).status_code == 409
    assert local.client.patch(f'/api/notes/{n["id"]}', json={'body': 'three'}).status_code == 200


def test_trash_restore_purge(local):
    c = local.client
    n = note(local, {})
    assert c.delete(f'/api/items/{n["id"]}').status_code == 204
    assert c.get('/api/items').json()['items'] == []
    assert c.get(f'/api/notes/{n["id"]}').status_code == 404
    assert len(c.get('/api/items', params={'trashed': True}).json()['items']) == 1
    c.post('/api/items/bulk', json={'ids': [n['id']], 'action': 'restore'})
    assert c.get(f'/api/notes/{n["id"]}').status_code == 200
    c.delete(f'/api/items/{n["id"]}')
    assert c.delete('/api/trash').status_code == 204
    assert c.get('/api/items', params={'trashed': True}).json()['items'] == []


def test_trash_expires(local):
    n = note(local, {})
    f = local.upload().json()
    local.client.post('/api/items/bulk', json={'ids': [n['id'], f['id']], 'action': 'trash'})
    with local.app.state.db.write() as db:
        db.get(Item, n['id']).deleted_at = utcnow() - timedelta(days=31)
        db.commit()
    run_maintenance(local.app)
    remaining = local.client.get('/api/items', params={'trashed': True}).json()['items']
    assert [i['id'] for i in remaining] == [f['id']]


def test_collections_tree_and_delete_keeps_contents(local):
    c = local.client
    top = collection(local, {}, 'top')
    mid = collection(local, {}, 'mid', parent_id=top['id'])
    leaf = collection(local, {}, 'leaf', parent_id=mid['id'])
    n = note(local, {}, collection_id=mid['id'])
    assert c.patch(f'/api/collections/{top["id"]}', json={'parent_id': leaf['id']}).status_code == 409
    assert c.patch(f'/api/collections/{top["id"]}', json={'parent_id': top['id']}).status_code == 409
    assert c.delete(f'/api/collections/{mid["id"]}').status_code == 204
    assert c.get(f'/api/notes/{n["id"]}').json()['collection_id'] == top['id']
    rows = {r['id']: r for r in c.get('/api/collections').json()}
    assert rows[leaf['id']]['parent_id'] == top['id'] and rows[top['id']]['item_count'] == 1


def test_collection_patch_can_clear_and_move(local):
    c = local.client
    a = collection(local, {}, 'a', color='#112233')
    b = collection(local, {}, 'b', parent_id=a['id'])
    assert c.patch(f'/api/collections/{a["id"]}', json={'color': None}).json()['color'] is None
    assert c.patch(f'/api/collections/{a["id"]}', json={'name': 'z'}).json()['name'] == 'z'
    assert c.patch(f'/api/collections/{b["id"]}', json={'parent_id': None}).json()['parent_id'] is None
    c.post('/api/collections/reorder', json={'parent_id': None, 'ids': [b['id'], a['id']]})
    assert [r['id'] for r in c.get('/api/collections').json()] == [b['id'], a['id']]


def test_bulk_move_pin_and_filters(local):
    c = local.client
    col = collection(local, {})
    a, b = note(local, {}, title='alpha'), note(local, {}, title='beta', body='has needle_here')
    c.post('/api/items/bulk', json={'ids': [a['id'], b['id']], 'action': 'move', 'collection_id': col['id']})
    assert c.get('/api/items', params={'collection': col['id']}).json()['total'] == 2
    assert c.get('/api/items', params={'unfiled': True}).json()['total'] == 0
    c.post('/api/items/bulk', json={'ids': [a['id']], 'action': 'pin'})
    listed = c.get('/api/items', params={'sort': 'title'}).json()['items']
    assert listed[0]['pinned'] and listed[0]['title'] == 'alpha'
    assert c.get('/api/items', params={'q': 'needle_here'}).json()['total'] == 1
    # % and _ are literal, not wildcards.
    assert c.get('/api/items', params={'q': '%'}).json()['total'] == 0
    assert c.get('/api/items', params={'q': 'needle_x'}).json()['total'] == 0


def test_rename_and_export(local):
    c = local.client
    n = note(local, {}, title='My plan', body='# hi')
    assert c.patch(f'/api/items/{n["id"]}', json={'title': 'Plan B'}).json()['title'] == 'Plan B'
    response = c.get(f'/api/notes/{n["id"]}/export')
    assert response.text == '# hi' and 'Plan%20B.md' in response.headers['content-disposition']


def test_board_flow(local):
    c = local.client
    board = c.post('/api/boards', json={'title': 'Work'}).json()
    todo, doing, done = [col['id'] for col in board['columns']]
    bid = board['id']
    ids = [c.post(f'/api/boards/{bid}/cards', json={'column_id': todo, 'title': t}).json()['id'] for t in 'abc']
    top = c.post(f'/api/boards/{bid}/cards', json={'column_id': todo, 'title': 'first', 'top': True}).json()

    def columns():
        return c.get(f'/api/boards/{bid}').json()['columns']

    assert [x['title'] for x in columns()[0]['cards']] == ['first', 'a', 'b', 'c']
    # Within a column.
    assert c.post(f'/api/cards/{ids[2]}/move', json={'index': 0}).status_code == 204
    assert [x['title'] for x in columns()[0]['cards']] == ['c', 'first', 'a', 'b']
    # Across columns.
    c.post(f'/api/cards/{ids[0]}/move', json={'index': 0, 'column_id': doing})
    assert [x['title'] for x in columns()[1]['cards']] == ['a']
    assert [x['title'] for x in columns()[0]['cards']] == ['c', 'first', 'b']
    # Past the end clamps.
    c.post(f'/api/cards/{top["id"]}/move', json={'index': 99, 'column_id': doing})
    assert [x['title'] for x in columns()[1]['cards']] == ['a', 'first']
    # Card fields, clearing included.
    patched = c.patch(f'/api/cards/{ids[0]}', json={'labels': ['bug'], 'due_date': '2030-01-02', 'body': 'x', 'color': '#ff0000'}).json()
    assert patched['labels'] == ['bug'] and patched['due_date'] == '2030-01-02'
    assert c.patch(f'/api/cards/{ids[0]}', json={'due_date': None, 'color': None}).json()['due_date'] is None
    # Columns: reorder, rename, delete moving cards.
    c.post(f'/api/columns/{done}/move', json={'index': 0})
    assert columns()[0]['id'] == done
    c.patch(f'/api/columns/{done}', json={'title': 'Shipped', 'color': '#00ff00'})
    assert c.delete(f'/api/columns/{doing}', params={'move_to': doing}).status_code == 422
    assert c.delete(f'/api/columns/{doing}', params={'move_to': todo}).status_code == 204
    remaining = columns()
    assert len(remaining) == 2 and len(remaining[1]['cards']) == 4
    # Deleted without move_to, the cards go too.
    c.delete(f'/api/columns/{todo}')
    assert all(not col['cards'] for col in columns())


def test_card_cannot_move_between_boards(local):
    c = local.client
    one = c.post('/api/boards', json={}).json()
    two = c.post('/api/boards', json={}).json()
    card = c.post(f'/api/boards/{one["id"]}/cards', json={'column_id': one['columns'][0]['id'], 'title': 't'}).json()
    assert c.post(f'/api/cards/{card["id"]}/move', json={'index': 0, 'column_id': two['columns'][0]['id']}).status_code == 422
    assert c.post(f'/api/boards/{two["id"]}/cards', json={'column_id': one['columns'][0]['id'], 'title': 't'}).status_code == 404


def test_upcoming_and_search(local):
    c = local.client
    board = c.post('/api/boards', json={'title': 'B'}).json()
    col = board['columns'][0]['id']
    card = c.post(f'/api/boards/{board["id"]}/cards', json={'column_id': col, 'title': 'pay rates'}).json()
    c.patch(f'/api/cards/{card["id"]}', json={'due_date': '2030-01-02'})
    assert c.get('/api/cards/upcoming').json()[0]['board_title'] == 'B'
    c.patch(f'/api/cards/{card["id"]}', json={'done': True})
    assert c.get('/api/cards/upcoming').json() == []
    hits = c.get('/api/search', params={'q': 'rates'}).json()
    assert hits[0]['type'] == 'card' and hits[0]['board_id'] == board['id']


def test_duplicate_board_and_file(local):
    c = local.client
    board = c.post('/api/boards', json={'title': 'B'}).json()
    c.post(f'/api/boards/{board["id"]}/cards', json={'column_id': board['columns'][1]['id'], 'title': 'x'})
    copy = c.post(f'/api/items/{board["id"]}/duplicate').json()
    copied = c.get(f'/api/boards/{copy["id"]}').json()
    assert copied['title'] == 'B (copy)' and copied['columns'][1]['cards'][0]['title'] == 'x'
    assert copied['columns'][1]['id'] != board['columns'][1]['id']
    f = local.upload(b'data').json()
    fcopy = c.post(f'/api/items/{f["id"]}/duplicate').json()
    assert c.get(f'/api/files/{fcopy["id"]}/raw').content == b'data'
    c.post('/api/items/bulk', json={'ids': [f['id']], 'action': 'purge'})
    assert c.get(f'/api/files/{fcopy["id"]}/raw').content == b'data'


def test_preferences_roundtrip(scoped, alice, bob):
    c = scoped.client
    assert c.get('/api/preferences', headers=alice).json()['data'] is None
    c.put('/api/preferences', json={'data': {'theme': 'sage'}}, headers=alice)
    assert c.get('/api/preferences', headers=alice).json()['data'] == {'theme': 'sage'}
    assert c.get('/api/preferences', headers=bob).json()['data'] is None


@pytest.mark.parametrize('body', [{'title': ''}, {'title': 'x' * 301}])
def test_validation_errors_are_readable(local, body):
    response = local.client.post('/api/notes', json=body)
    assert response.status_code == 422 and 'title' in response.json()['error']
