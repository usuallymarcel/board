"""The truth table from the README."""


def test_healthy_requires_login(scoped):
    assert scoped.client.get('/api/items').status_code == 401
    assert scoped.client.get('/api/session').json()['mode'] == 'scoped'


def test_login_and_logout(scoped):
    assert scoped.login().status_code == 200
    assert scoped.client.get('/api/session').json()['user']['name'] == 'alice'
    assert scoped.client.get('/api/items').status_code == 200
    scoped.client.post('/api/auth/logout')
    assert scoped.client.get('/api/items').status_code == 401


def test_bad_password_is_401(scoped):
    response = scoped.client.post('/api/auth/login', json={'name': 'alice', 'password': 'nope'})
    assert response.status_code == 401


def test_login_rate_limited(scoped):
    for _ in range(10):
        scoped.client.post('/api/auth/login', json={'name': 'alice', 'password': 'nope'})
    assert scoped.client.post('/api/auth/login', json={'name': 'alice', 'password': 'nope'}).status_code == 429


def test_outage_fails_closed_by_default(scoped, alice):
    scoped.users.mode = 'down'
    scoped.refresh_status()
    assert scoped.client.get('/api/items', headers=alice).status_code == 503
    assert scoped.client.get('/api/items').status_code == 503
    # Public pages keep working.
    assert scoped.client.get('/api/forum/posts').status_code == 200
    scoped.users.mode = 'ok'
    scoped.refresh_status()
    assert scoped.client.get('/api/items', headers=alice).status_code == 200


def test_missing_capabilities_counts_as_down(scoped):
    scoped.users.mode = 'no_caps'
    scoped.refresh_status()
    assert scoped.client.get('/api/session').json()['auth_status'] == 'unavailable'


def test_global_fail_mode_is_a_separate_workspace(make_harness):
    h = make_harness(auth_fail_mode='global')
    cookie = h.as_user('alice')
    private = h.client.post('/api/notes', json={'title': 'mine'}, headers=cookie).json()
    h.users.mode = 'down'
    h.refresh_status()
    assert h.client.get('/api/items').json()['items'] == []
    assert h.client.get(f'/api/notes/{private["id"]}').status_code == 404
    # No anonymous posting to the public forum during an outage.
    assert h.client.post('/api/forum/posts', json={'title': 't', 'body': 'b'}).status_code == 503


def test_no_users_api_is_single_user(local):
    session = local.client.get('/api/session').json()
    assert session['auth_status'] == 'disabled' and session['is_admin']
    assert local.client.post('/api/notes', json={'title': 'x'}).status_code == 201
    assert local.client.post('/api/forum/posts', json={'title': 't', 'body': 'b'}).json()['author_name'] == 'Local'


def test_csrf_and_headers(local):
    assert local.client.post('/api/notes', json={}, headers={'Origin': 'https://evil.example'}).status_code == 403
    assert local.client.post('/api/notes', json={}, headers={'Origin': 'http://board.test'}).status_code == 201
    headers = local.client.get('/api/healthz').headers
    assert "script-src 'self';" in headers['content-security-policy']
    assert headers['cache-control'] == 'no-store'
    assert headers['x-content-type-options'] == 'nosniff'


def test_readyz(scoped):
    assert scoped.client.get('/api/readyz').json() == {'status': 'ok', 'users_api': 'ok'}
