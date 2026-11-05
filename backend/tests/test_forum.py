def post(h, headers, **body):
    response = h.client.post('/api/forum/posts', json={'title': 'T', 'body': 'B', **body}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def test_public_reads_guest_cannot_write(scoped, alice):
    c = scoped.client
    p = post(scoped, alice, category='News')
    assert p['author_name'] == 'alice'
    assert c.get('/api/forum/posts').json()['total'] == 1
    assert c.get(f'/api/forum/posts/{p["id"]}').json()['title'] == 'T'
    assert c.post('/api/forum/posts', json={'title': 't', 'body': 'b'}).status_code == 401
    assert c.post(f'/api/forum/posts/{p["id"]}/comments', json={'body': 'x'}).status_code == 401


def test_comments_and_ownership(scoped, alice, bob):
    c = scoped.client
    p = post(scoped, alice)
    comment = c.post(f'/api/forum/posts/{p["id"]}/comments', json={'body': 'nice'}, headers=bob).json()
    detail = c.get(f'/api/forum/posts/{p["id"]}').json()
    assert detail['comment_count'] == 1 and detail['comments'][0]['author_name'] == 'bob'
    assert c.patch(f'/api/forum/posts/{p["id"]}', json={'title': 'x'}, headers=bob).status_code == 403
    assert c.delete(f'/api/forum/posts/{p["id"]}', headers=bob).status_code == 403
    assert c.patch(f'/api/forum/comments/{comment["id"]}', json={'body': 'x'}, headers=alice).status_code == 403
    assert c.delete(f'/api/forum/comments/{comment["id"]}', headers=alice).status_code == 403
    assert c.patch(f'/api/forum/comments/{comment["id"]}', json={'body': 'edited'}, headers=bob).json()['body'] == 'edited'
    assert c.patch(f'/api/forum/posts/{p["id"]}', json={'title': 'new'}, headers=alice).json()['title'] == 'new'
    assert c.delete(f'/api/forum/comments/{comment["id"]}', headers=bob).status_code == 204
    assert c.get(f'/api/forum/posts/{p["id"]}').json()['comment_count'] == 0
    assert c.delete(f'/api/forum/posts/{p["id"]}', headers=alice).status_code == 204
    assert c.get(f'/api/forum/posts/{p["id"]}').status_code == 404


def test_only_moderators_pin_and_lock(make_harness):
    h = make_harness(admin_users='Alice')
    a, b = h.as_user('alice'), h.as_user('bob')
    p = post(h, b)
    assert h.client.patch(f'/api/forum/posts/{p["id"]}', json={'pinned': True}, headers=b).status_code == 403
    assert h.client.patch(f'/api/forum/posts/{p["id"]}', json={'pinned': True, 'locked': True}, headers=a).json()['locked']
    assert h.client.post(f'/api/forum/posts/{p["id"]}/comments', json={'body': 'x'}, headers=b).status_code == 403
    assert h.client.post(f'/api/forum/posts/{p["id"]}/comments', json={'body': 'x'}, headers=a).status_code == 201
    assert h.client.get('/api/session', headers=a).json()['is_admin'] is True
    assert h.client.get('/api/session', headers=b).json()['is_admin'] is False
    assert h.client.delete(f'/api/forum/posts/{p["id"]}', headers=a).status_code == 204


def test_filter_search_and_order(local):
    c = local.client
    a = post(local, {}, title='Alpha', category='News')
    post(local, {}, title='Beta')
    assert c.get('/api/forum/posts', params={'category': 'News'}).json()['total'] == 1
    assert c.get('/api/forum/posts', params={'q': 'alpha'}).json()['total'] == 1
    assert c.get('/api/forum/posts').json()['categories'] == ['General', 'News']
    c.post(f'/api/forum/posts/{a["id"]}/comments', json={'body': 'bump'})
    assert c.get('/api/forum/posts').json()['posts'][0]['title'] == 'Alpha'


def test_posting_is_rate_limited(local):
    codes = [local.client.post('/api/forum/posts', json={'title': 't', 'body': 'b'}).status_code for _ in range(21)]
    assert codes[-1] == 429


def test_blank_posts_rejected(local):
    assert local.client.post('/api/forum/posts', json={'title': '   ', 'body': 'b'}).status_code == 422
