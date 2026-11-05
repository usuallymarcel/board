import io

from PIL import Image

PNG = b'\x89PNG\r\n\x1a\n' + b'\0' * 32


def jpeg_with_gps() -> bytes:
    image = Image.new('RGB', (8, 8), 'red')
    exif = image.getexif()
    exif[0x010F] = 'SecretCamera'
    out = io.BytesIO()
    image.save(out, 'JPEG', exif=exif)
    return out.getvalue()


def test_upload_download_private(scoped, alice):
    f = scoped.upload(b'hello', 'notes.txt', alice).json()
    assert f['kind'] == 'file' and f['file']['size'] == 5
    assert scoped.client.get(f'/api/files/{f["id"]}/raw').status_code == 401
    assert scoped.client.get(f'/api/media/{f["id"]}/notes.txt').status_code == 404
    response = scoped.client.get(f'/api/files/{f["id"]}/raw', headers=alice)
    assert response.content == b'hello'
    assert response.headers['content-disposition'].startswith('attachment')


def test_html_and_svg_never_render(local):
    for name, content in [('x.html', b'<script>alert(1)</script>'), ('x.svg', b'<svg onload="alert(1)"/>'), ('fake.png', b'<script>')]:
        f = local.upload(content, name).json()
        response = local.client.get(f'/api/files/{f["id"]}/raw')
        assert response.headers['content-type'] == 'application/octet-stream', name
        assert response.headers['content-disposition'].startswith('attachment'), name
        assert response.headers['x-content-type-options'] == 'nosniff'


def test_real_image_renders_and_sniffing_ignores_extension(local):
    f = local.upload(PNG, 'photo.dat').json()
    assert f['file']['mime'] == 'image/png'
    response = local.client.get(f'/api/files/{f["id"]}/raw')
    assert response.headers['content-type'] == 'image/png'
    assert response.headers['content-disposition'].startswith('inline')
    download = local.client.get(f'/api/files/{f["id"]}/raw', params={'download': True})
    assert download.headers['content-disposition'].startswith('attachment')


def test_inline_media_is_public_but_trash_removes_it(scoped, alice):
    f = scoped.upload(PNG, 'p.png', alice, inline='true').json()
    url = f'/api/media/{f["id"]}/p.png'
    assert scoped.client.get(url).status_code == 200
    # Hidden from the normal listing, shown when asked for.
    assert scoped.client.get('/api/items', headers=alice).json()['total'] == 0
    assert scoped.client.get('/api/items', params={'inline': True}, headers=alice).json()['total'] == 1
    scoped.client.delete(f'/api/items/{f["id"]}', headers=alice)
    assert scoped.client.get(url).status_code == 404


def test_inline_toggle(local):
    f = local.upload(PNG, 'p.png').json()
    assert local.client.get(f'/api/media/{f["id"]}/p.png').status_code == 404
    assert local.client.patch(f'/api/items/{f["id"]}', json={'inline': True}).status_code == 200
    assert local.client.get(f'/api/media/{f["id"]}/p.png').status_code == 200


def test_inline_jpeg_loses_exif(local):
    raw = jpeg_with_gps()
    assert b'SecretCamera' in raw
    f = local.upload(raw, 'p.jpg', inline='true').json()
    stored = local.client.get(f'/api/media/{f["id"]}/p.jpg').content
    assert b'SecretCamera' not in stored
    assert Image.open(io.BytesIO(stored)).size == (8, 8)


def test_corrupt_inline_image_rejected(local):
    assert local.upload(b'\xff\xd8\xff' + b'junk' * 10, 'p.jpg', inline='true').status_code == 415
    assert list(local.settings.tmp_dir.iterdir()) == []


def test_limits(local):
    assert local.upload(b'x' * (2 * 1024 * 1024 + 1), 'big.bin').status_code == 413
    assert local.upload(b'', 'empty.bin').status_code == 400
    assert list(local.settings.tmp_dir.iterdir()) == []


def test_quota_counts_trash_until_purged(local):
    for _ in range(3):
        assert local.upload(b'x' * (1024 * 1024)).status_code == 201
    assert local.upload(b'x' * 1024).status_code == 413
    ids = [i['id'] for i in local.client.get('/api/items').json()['items']]
    local.client.post('/api/items/bulk', json={'ids': ids, 'action': 'trash'})
    assert local.upload(b'x' * 1024).status_code == 413
    local.client.delete('/api/trash')
    assert local.upload(b'x' * 1024).status_code == 201
    assert local.client.get('/api/usage').json()['used'] == 1024
    assert list(local.settings.tmp_dir.iterdir()) == []


def test_purge_removes_bytes(local):
    f = local.upload(b'bytes').json()
    stored = [p for p in local.settings.file_dir.rglob('*') if p.is_file()]
    assert len(stored) == 1
    local.client.post('/api/items/bulk', json={'ids': [f['id']], 'action': 'purge'})
    assert not stored[0].exists()


def test_upload_into_foreign_collection_rejected(scoped, alice, bob):
    col = scoped.client.post('/api/collections', json={'name': 'c'}, headers=alice).json()
    assert scoped.upload(headers=bob, collection_id=col['id']).status_code == 404
    assert list(scoped.settings.tmp_dir.iterdir()) == []


def test_filename_cannot_traverse(local):
    f = local.upload(b'x', '../../etc/passwd').json()
    assert f['file']['filename'] == 'passwd'
