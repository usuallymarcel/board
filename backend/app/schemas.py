from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Color = Annotated[str, StringConstraints(pattern=r'^#[0-9a-fA-F]{6}$')]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Body = Annotated[str, StringConstraints(max_length=1_000_000)]
Short = Annotated[str, StringConstraints(max_length=20_000)]
PostTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
PostBody = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100_000)]
Category = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
Hash = Annotated[str, StringConstraints(pattern=r'^[0-9a-f]{64}$')]
Kind = Literal['note', 'board', 'file']


class Orm(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class User(BaseModel):
    id: int
    name: str


class Credentials(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=256)


class Signup(Credentials):
    password: str = Field(min_length=8, max_length=256)


class Session(BaseModel):
    mode: Literal['global', 'scoped']
    auth_status: Literal['disabled', 'unavailable', 'ok']
    user: User | None
    allow_signup: bool
    max_upload_mb: int
    quota_mb: int
    is_admin: bool


class CollectionIn(BaseModel):
    name: Name
    parent_id: str | None = None
    color: Color | None = None
    icon: str | None = Field(default=None, max_length=16)


class CollectionPatch(BaseModel):
    name: Name | None = None
    parent_id: str | None = None
    color: Color | None = None
    icon: str | None = Field(default=None, max_length=16)


class CollectionOut(Orm):
    id: str
    parent_id: str | None
    name: str
    color: str | None
    icon: str | None
    position: int
    item_count: int = 0


class Reorder(BaseModel):
    parent_id: str | None = None
    ids: list[str] = Field(max_length=2000)


class FileMeta(Orm):
    filename: str
    mime: str
    size: int
    inline: bool


class ItemOut(BaseModel):
    id: str
    kind: Kind
    title: str
    snippet: str = ''
    collection_id: str | None
    pinned: bool
    version: int
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None
    file: FileMeta | None = None
    card_count: int | None = None


class ItemList(BaseModel):
    items: list[ItemOut]
    total: int


class ItemPatch(BaseModel):
    title: Title | None = None
    collection_id: str | None = None
    pinned: bool | None = None
    inline: bool | None = None


class Bulk(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=1000)
    action: Literal['move', 'pin', 'unpin', 'trash', 'restore', 'purge']
    collection_id: str | None = None


class NoteIn(BaseModel):
    title: Title = 'Untitled'
    body: Body = ''
    collection_id: str | None = None


class NotePatch(BaseModel):
    title: Title | None = None
    body: Body | None = None
    # The version this edit was based on. A mismatch is a conflict; omit to overwrite on purpose.
    version: int | None = None


class NoteOut(ItemOut):
    body: str


class BoardIn(BaseModel):
    title: Title = 'Untitled board'
    collection_id: str | None = None
    columns: list[Name] = Field(default_factory=lambda: ['To do', 'Doing', 'Done'], max_length=30)


class BoardPatch(BaseModel):
    title: Title | None = None
    body: Short | None = None


class ColumnIn(BaseModel):
    title: Name
    color: Color | None = None


class ColumnPatch(BaseModel):
    title: Name | None = None
    color: Color | None = None


class Move(BaseModel):
    index: int = Field(ge=0)
    column_id: int | None = None


class CardIn(BaseModel):
    column_id: int
    title: Title
    body: Body = ''
    # Top of the column instead of the bottom.
    top: bool = False


class CardPatch(BaseModel):
    title: Title | None = None
    body: Body | None = None
    labels: list[Label] | None = Field(default=None, max_length=20)
    due_date: date | None = None
    done: bool | None = None
    color: Color | None = None


class CardOut(Orm):
    id: int
    column_id: int
    title: str
    body: str
    labels: list[str]
    due_date: date | None
    done: bool
    color: str | None
    position: int
    updated_at: datetime


class ColumnOut(Orm):
    id: int
    title: str
    color: str | None
    position: int
    cards: list[CardOut] = []


class BoardOut(ItemOut):
    body: str
    columns: list[ColumnOut]


class UpcomingCard(BaseModel):
    id: int
    board_id: str
    board_title: str
    column_title: str
    title: str
    due_date: date | None
    done: bool


class ShareIn(BaseModel):
    item_id: str
    password: str | None = Field(default=None, min_length=1, max_length=256)
    expires_in_hours: int | None = Field(default=None, ge=1, le=24 * 365)
    max_views: int | None = Field(default=None, ge=1, le=100000)


class ShareOut(BaseModel):
    id: int
    item_id: str
    token: str
    has_password: bool
    expires_at: datetime | None
    max_views: int | None
    views: int
    created_at: datetime


class ShareInfo(BaseModel):
    title: str
    kind: Kind
    needs_password: bool


class Unlock(BaseModel):
    password: str = Field(max_length=256)


class Grant(BaseModel):
    grant: str


class SharedView(BaseModel):
    kind: Kind
    title: str
    updated_at: datetime
    body: str = ''
    columns: list[ColumnOut] | None = None
    file: FileMeta | None = None


class SecretIn(BaseModel):
    label: str = Field(default='', max_length=200)
    ciphertext: str = Field(min_length=1, max_length=350_000)
    iv: str = Field(min_length=8, max_length=32)
    salt: str | None = Field(default=None, max_length=44)
    verifier: Hash | None = None
    max_views: int = Field(default=1, ge=1, le=100)
    expires_in_hours: int = Field(default=24, ge=1, le=24 * 30)


class SecretOut(BaseModel):
    id: str
    label: str
    max_views: int
    views: int
    expires_at: datetime
    created_at: datetime
    active: bool
    has_passphrase: bool


class SecretInfo(BaseModel):
    has_passphrase: bool
    salt: str | None
    views_left: int
    expires_at: datetime


class SecretReveal(BaseModel):
    verifier: Hash | None = None


class SecretPayload(BaseModel):
    ciphertext: str
    iv: str
    views_left: int


class PostIn(BaseModel):
    title: PostTitle
    body: PostBody
    category: Category = 'General'


class PostPatch(BaseModel):
    title: PostTitle | None = None
    body: PostBody | None = None
    category: Category | None = None
    pinned: bool | None = None
    locked: bool | None = None


class PostOut(Orm):
    id: int
    author_id: int
    author_name: str
    title: str
    body: str
    category: str
    pinned: bool
    locked: bool
    comment_count: int
    created_at: datetime
    updated_at: datetime
    activity_at: datetime


class PostList(BaseModel):
    posts: list[PostOut]
    total: int
    categories: list[str]


class CommentIn(BaseModel):
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20_000)]


class CommentOut(Orm):
    id: int
    post_id: int
    author_id: int
    author_name: str
    body: str
    created_at: datetime
    updated_at: datetime


class PostDetail(PostOut):
    comments: list[CommentOut]


class SearchHit(BaseModel):
    type: Literal['note', 'board', 'file', 'card', 'collection']
    id: str
    title: str
    snippet: str = ''
    board_id: str | None = None


class Usage(BaseModel):
    used: int
    quota: int
    notes: int
    boards: int
    files: int
    trash: int


class PreferencesEnvelope(BaseModel):
    data: dict | None
    updated_at: datetime | None = None


class PreferencesIn(BaseModel):
    data: dict
