"""Files on the data volume, and receiving uploads without holding them in memory."""
import hashlib
import mimetypes
import re
import shutil
import tempfile
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from PIL import Image, ImageOps
from python_multipart.multipart import MultipartParser, parse_options_header

from app.config import Settings

MAX_FILENAME = 255
MAX_FIELD = 1024
SNIFF_WINDOW = 64
# Multipart boundaries and part headers on top of the file itself.
MULTIPART_OVERHEAD = 64 * 1024

# Only types recognised from the bytes are ever shown in the browser. Anything else, HTML and SVG
# above all, downloads as an opaque attachment and cannot script this origin.
RENDERABLE = {
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
    'application/pdf', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/ogg', 'audio/wav',
}
STRIPPABLE = {'image/jpeg': 'JPEG', 'image/webp': 'WEBP'}
Image.MAX_IMAGE_PIXELS = 100_000_000


class UploadRejected(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message


def new_id() -> str:
    return uuid.uuid4().hex


def clean_tmp(settings: Settings) -> None:
    """Whatever is in tmp at boot was left by a crash."""
    for entry in settings.tmp_dir.iterdir():
        if entry.is_dir():
            shutil.rmtree(entry, ignore_errors=True)
        else:
            entry.unlink(missing_ok=True)


def stored_path(settings: Settings, stored_name: str) -> Path:
    return settings.file_dir / stored_name[:2] / stored_name


def remove_stored(settings: Settings, stored_name: str) -> None:
    stored_path(settings, stored_name).unlink(missing_ok=True)


def keep_upload(settings: Settings, source: Path) -> str:
    stored_name = new_id()
    target = stored_path(settings, stored_name)
    target.parent.mkdir(exist_ok=True)
    source.replace(target)
    return stored_name


def clean_filename(raw: str) -> str:
    name = re.split(r'[\\/]', raw)[-1]
    name = re.sub(r'[\x00-\x1f\x7f]', '', name).strip()
    return name[-MAX_FILENAME:] or 'file'


def sniff_mime(head: bytes, filename: str) -> str:
    """The real type from magic bytes. The name only labels files nothing here will render."""
    if head.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png'
    if head.startswith(b'\xff\xd8\xff'):
        return 'image/jpeg'
    if head.startswith((b'GIF87a', b'GIF89a')):
        return 'image/gif'
    if head[:4] == b'RIFF' and head[8:12] == b'WEBP':
        return 'image/webp'
    if head[:4] == b'RIFF' and head[8:12] == b'WAVE':
        return 'audio/wav'
    if head[4:12] in (b'ftypavif', b'ftypavis'):
        return 'image/avif'
    if head[4:8] == b'ftyp':
        return 'video/mp4'
    if head.startswith(b'%PDF-'):
        return 'application/pdf'
    if head.startswith(b'\x1a\x45\xdf\xa3'):
        return 'video/webm'
    if head.startswith(b'ID3') or head[:2] in (b'\xff\xfb', b'\xff\xf3'):
        return 'audio/mpeg'
    if head.startswith(b'OggS'):
        return 'audio/ogg'
    guessed = mimetypes.guess_type(filename)[0] or 'application/octet-stream'
    return 'application/octet-stream' if guessed in RENDERABLE else guessed


def strip_metadata(path: Path, mime: str) -> tuple[int, str] | None:
    """Phone photos carry GPS coordinates, and pasted images can end up on the public forum.
    Returns the new (size, sha256). Animated images are left alone rather than flattened."""
    image_format = STRIPPABLE.get(mime)
    if not image_format:
        return None
    cleaned = path.with_suffix('.clean')
    try:
        with Image.open(path) as image:
            if getattr(image, 'is_animated', False):
                return None
            upright = ImageOps.exif_transpose(image)
            mode = 'RGB' if image_format == 'JPEG' else ('RGBA' if upright.mode == 'RGBA' else 'RGB')
            upright.convert(mode).save(cleaned, image_format, quality=90)
    except (OSError, ValueError, SyntaxError, Image.DecompressionBombError) as error:
        cleaned.unlink(missing_ok=True)
        raise UploadRejected(415, 'That image could not be read.') from error
    cleaned.replace(path)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return path.stat().st_size, digest


def file_response(settings: Settings, stored_name: str, filename: str, mime: str, *, download: bool) -> FileResponse:
    render = mime in RENDERABLE and not download
    return FileResponse(
        stored_path(settings, stored_name),
        media_type=mime if render else 'application/octet-stream',
        filename=filename,
        content_disposition_type='inline' if render else 'attachment',
        headers={
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; object-src 'self'; media-src 'self'; img-src 'self'",
            'Cross-Origin-Resource-Policy': 'same-origin',
            'Cache-Control': 'private, max-age=3600',
        },
    )


class _FileSink:
    """Writes one upload to /data/tmp, hashing as it goes and enforcing limits on the fly."""

    def __init__(self, directory: Path, limit: int):
        handle = tempfile.NamedTemporaryFile(dir=directory, prefix='upload-', delete=False)
        self.handle = handle
        self.path = Path(handle.name)
        self.limit = limit
        self.size = 0
        self.digest = hashlib.sha256()
        self.head = bytearray()

    def write(self, data: bytes) -> None:
        self.size += len(data)
        if self.size > self.limit:
            raise UploadRejected(413, 'That file is larger than the upload limit.')
        if len(self.head) < SNIFF_WINDOW:
            self.head += data[: SNIFF_WINDOW - len(self.head)]
        self.digest.update(data)
        self.handle.write(data)

    def discard(self) -> None:
        self.handle.close()
        self.path.unlink(missing_ok=True)


@dataclass
class _Part:
    name: str = ''
    filename: str | None = None
    header_field: bytes = b''
    header_value: bytes = b''
    data: bytearray = field(default_factory=bytearray)


@dataclass
class ReceivedUpload:
    path: Path
    filename: str
    size: int
    sha256: str
    mime: str
    fields: dict[str, str]


class _UploadParser:
    """Callbacks for python-multipart's low-level parser. Starlette's request.form() would spool
    the whole body to the system temp dir before a route could enforce anything."""

    def __init__(self, settings: Settings, boundary: bytes):
        self.settings = settings
        self.sink: _FileSink | None = None
        self.filename = ''
        self.fields: dict[str, str] = {}
        self.part = _Part()
        self.parser = MultipartParser(boundary, callbacks={
            'on_part_begin': self.on_part_begin,
            'on_header_field': self.on_header_field,
            'on_header_value': self.on_header_value,
            'on_header_end': self.on_header_end,
            'on_part_data': self.on_part_data,
            'on_part_end': self.on_part_end,
        })

    def on_part_begin(self) -> None:
        self.part = _Part()

    def on_header_field(self, data: bytes, start: int, end: int) -> None:
        self.part.header_field += data[start:end]

    def on_header_value(self, data: bytes, start: int, end: int) -> None:
        self.part.header_value += data[start:end]

    def on_header_end(self) -> None:
        part = self.part
        if part.header_field.lower() == b'content-disposition':
            _, options = parse_options_header(part.header_value)
            part.name = options.get(b'name', b'').decode('utf-8', 'replace')
            if b'filename' in options:
                part.filename = options[b'filename'].decode('utf-8', 'replace')
        part.header_field, part.header_value = b'', b''

    def on_part_data(self, data: bytes, start: int, end: int) -> None:
        part = self.part
        if part.name == 'file' and part.filename is not None:
            if self.sink is None:
                self.sink = _FileSink(self.settings.tmp_dir, self.settings.max_upload_bytes)
                self.filename = part.filename
            self.sink.write(data[start:end])
        elif len(part.data) + end - start <= MAX_FIELD:
            part.data += data[start:end]

    def on_part_end(self) -> None:
        if self.part.filename is None and self.part.name:
            self.fields[self.part.name] = self.part.data.decode('utf-8', 'replace')

    def write(self, chunk: bytes) -> None:
        self.parser.write(chunk)


async def receive_upload(request: Request, settings: Settings) -> ReceivedUpload:
    """Streams a multipart upload to /data/tmp. The caller owns the returned temp file. On any
    failure, a client abort included, the temp file is gone by the time this raises."""
    content_type, options = parse_options_header(request.headers.get('content-type', ''))
    boundary = options.get(b'boundary')
    if content_type != b'multipart/form-data' or not boundary:
        raise UploadRejected(400, 'Expected a multipart upload.')

    length = request.headers.get('content-length', '')
    if length.isdigit() and int(length) > settings.max_upload_bytes + MULTIPART_OVERHEAD:
        raise UploadRejected(413, 'That file is larger than the upload limit.')

    parser = _UploadParser(settings, boundary)
    try:
        async for chunk in request.stream():
            if chunk:
                # Hashing and disk writes must not stall the event loop.
                await run_in_threadpool(parser.write, chunk)
        sink = parser.sink
        if sink is None or sink.size == 0:
            raise UploadRejected(400, 'Choose a file to upload.')
        sink.handle.close()
    except BaseException:
        # BaseException: a task cancelled at shutdown must not leave its temp file behind either.
        if parser.sink:
            parser.sink.discard()
        raise
    filename = clean_filename(parser.filename)
    return ReceivedUpload(
        path=sink.path,
        filename=filename,
        size=sink.size,
        sha256=sink.digest.hexdigest(),
        mime=sniff_mime(bytes(sink.head), filename),
        fields=parser.fields,
    )
