import type {
  Board, Card, Collection, Column, Comment, Item, ItemList, Kind, Note, Post, PostDetail, PostList, PreferencesEnvelope,
  SearchHit, Secret, SecretInfo, SecretPayload, Session, Share, SharedView, ShareInfo, UpcomingCard, Usage,
} from './types'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Fired whenever any request gets a 401, so the app can flip to the login screen. */
export const AUTH_REQUIRED_EVENT = 'board:auth-required'

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && typeof init.body === 'string') headers.set('Content-Type', 'application/json')
  const res = await fetch(path, { credentials: 'same-origin', ...init, headers })
  if (res.status === 401) window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT))
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
})

const query = (params: Record<string, string | number | boolean | null | undefined>) => {
  const out = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') out.set(key, String(value))
  const text = out.toString()
  return text ? `?${text}` : ''
}

export interface ItemQuery {
  kind?: Kind
  collection?: string
  unfiled?: boolean
  q?: string
  pinned?: boolean
  trashed?: boolean
  inline?: boolean
  sort?: string
  limit?: number
}

export type BulkAction = 'move' | 'pin' | 'unpin' | 'trash' | 'restore' | 'purge'
export type CardPatch = Partial<Pick<Card, 'title' | 'body' | 'labels' | 'due_date' | 'done' | 'color'>>

export const fileUrl = (id: string, download = false) => `/api/files/${id}/raw${download ? '?download=true' : ''}`
export const mediaUrl = (id: string, name: string) => `/api/media/${id}/${encodeURIComponent(name)}`
export const exportUrl = (id: string) => `/api/notes/${id}/export`
export const sharedFileUrl = (token: string, grant: string | null, download = false) =>
  `/api/public/shares/${token}/file${query({ grant, download: download || undefined })}`

export const api = {
  session: () => request<Session>('/api/session'),
  login: (name: string, password: string) => request<Session>('/api/auth/login', json('POST', { name, password })),
  signup: (name: string, password: string) => request<Session>('/api/auth/signup', json('POST', { name, password })),
  logout: () => request<Session>('/api/auth/logout', json('POST')),
  preferences: () => request<PreferencesEnvelope>('/api/preferences'),
  savePreferences: (data: Record<string, unknown>) => request<PreferencesEnvelope>('/api/preferences', json('PUT', { data })),
  usage: () => request<Usage>('/api/usage'),
  search: (q: string) => request<SearchHit[]>(`/api/search${query({ q })}`),

  collections: () => request<Collection[]>('/api/collections'),
  createCollection: (body: { name: string; parent_id?: string | null; color?: string | null; icon?: string | null }) =>
    request<Collection>('/api/collections', json('POST', body)),
  patchCollection: (id: string, patch: Partial<Pick<Collection, 'name' | 'parent_id' | 'color' | 'icon'>>) =>
    request<Collection>(`/api/collections/${id}`, json('PATCH', patch)),
  reorderCollections: (parent_id: string | null, ids: string[]) => request<void>('/api/collections/reorder', json('POST', { parent_id, ids })),
  deleteCollection: (id: string) => request<void>(`/api/collections/${id}`, { method: 'DELETE' }),

  items: (q: ItemQuery) => request<ItemList>(`/api/items${query({ ...q })}`),
  patchItem: (id: string, patch: { title?: string; collection_id?: string | null; pinned?: boolean; inline?: boolean }) =>
    request<Item>(`/api/items/${id}`, json('PATCH', patch)),
  bulk: (ids: string[], action: BulkAction, collection_id?: string | null) =>
    request<{ count: number }>('/api/items/bulk', json('POST', { ids, action, collection_id })),
  trash: (id: string) => request<void>(`/api/items/${id}`, { method: 'DELETE' }),
  emptyTrash: () => request<void>('/api/trash', { method: 'DELETE' }),
  duplicate: (id: string) => request<Item>(`/api/items/${id}/duplicate`, json('POST')),

  createNote: (body: { title?: string; body?: string; collection_id?: string | null }) => request<Note>('/api/notes', json('POST', body)),
  note: (id: string) => request<Note>(`/api/notes/${id}`),
  patchNote: (id: string, patch: { title?: string; body?: string; version?: number }, keepalive = false) =>
    request<Note>(`/api/notes/${id}`, { ...json('PATCH', patch), keepalive }),

  createBoard: (body: { title?: string; collection_id?: string | null }) => request<Board>('/api/boards', json('POST', body)),
  board: (id: string) => request<Board>(`/api/boards/${id}`),
  patchBoard: (id: string, patch: { title?: string; body?: string }) => request<Board>(`/api/boards/${id}`, json('PATCH', patch)),
  createColumn: (id: string, title: string) => request<Column>(`/api/boards/${id}/columns`, json('POST', { title })),
  patchColumn: (id: number, patch: { title?: string; color?: string | null }) => request<Column>(`/api/columns/${id}`, json('PATCH', patch)),
  moveColumn: (id: number, index: number) => request<void>(`/api/columns/${id}/move`, json('POST', { index })),
  deleteColumn: (id: number, moveTo?: number) => request<void>(`/api/columns/${id}${query({ move_to: moveTo })}`, { method: 'DELETE' }),
  createCard: (boardId: string, column_id: number, title: string) => request<Card>(`/api/boards/${boardId}/cards`, json('POST', { column_id, title })),
  patchCard: (id: number, patch: CardPatch) => request<Card>(`/api/cards/${id}`, json('PATCH', patch)),
  moveCard: (id: number, column_id: number, index: number) => request<void>(`/api/cards/${id}/move`, json('POST', { column_id, index })),
  deleteCard: (id: number) => request<void>(`/api/cards/${id}`, { method: 'DELETE' }),
  upcoming: () => request<UpcomingCard[]>('/api/cards/upcoming'),

  shares: (itemId: string) => request<Share[]>(`/api/shares${query({ item_id: itemId })}`),
  createShare: (body: { item_id: string; password?: string; expires_in_hours?: number; max_views?: number }) =>
    request<Share>('/api/shares', json('POST', body)),
  deleteShare: (id: number) => request<void>(`/api/shares/${id}`, { method: 'DELETE' }),
  shareInfo: (token: string) => request<ShareInfo>(`/api/public/shares/${token}/info`),
  unlockShare: (token: string, password: string) => request<{ grant: string }>(`/api/public/shares/${token}/unlock`, json('POST', { password })),
  sharedView: (token: string, grant: string | null) => request<SharedView>(`/api/public/shares/${token}${query({ grant })}`),

  secrets: () => request<Secret[]>('/api/secrets'),
  createSecret: (body: Record<string, unknown>) => request<Secret>('/api/secrets', json('POST', body)),
  deleteSecret: (id: string) => request<void>(`/api/secrets/${id}`, { method: 'DELETE' }),
  secretInfo: (id: string) => request<SecretInfo>(`/api/public/secrets/${id}`),
  revealSecret: (id: string, verifier?: string) => request<SecretPayload>(`/api/public/secrets/${id}/reveal`, json('POST', { verifier })),

  posts: (params: { q?: string; category?: string; limit?: number; offset?: number }) => request<PostList>(`/api/forum/posts${query(params)}`),
  post: (id: number) => request<PostDetail>(`/api/forum/posts/${id}`),
  createPost: (body: { title: string; body: string; category: string }) => request<Post>('/api/forum/posts', json('POST', body)),
  patchPost: (id: number, patch: Partial<Pick<Post, 'title' | 'body' | 'category' | 'pinned' | 'locked'>>) =>
    request<Post>(`/api/forum/posts/${id}`, json('PATCH', patch)),
  deletePost: (id: number) => request<void>(`/api/forum/posts/${id}`, { method: 'DELETE' }),
  createComment: (postId: number, body: string) => request<Comment>(`/api/forum/posts/${postId}/comments`, json('POST', { body })),
  patchComment: (id: number, body: string) => request<Comment>(`/api/forum/comments/${id}`, json('PATCH', { body })),
  deleteComment: (id: number) => request<void>(`/api/forum/comments/${id}`, { method: 'DELETE' }),
}

/** XHR because fetch has no upload progress. */
export function uploadFile(
  file: File,
  fields: { inline?: boolean; collection_id?: string | null },
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Item> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const form = new FormData()
    if (fields.inline) form.append('inline', 'true')
    if (fields.collection_id) form.append('collection_id', fields.collection_id)
    form.append('file', file)
    xhr.open('POST', '/api/files')
    xhr.responseType = 'json'
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total) }
    xhr.onload = () => {
      if (xhr.status === 401) window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT))
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as Item)
      else reject(new ApiError(xhr.status, (xhr.response as { error?: string } | null)?.error ?? `Upload failed (${xhr.status})`))
    }
    xhr.onerror = () => reject(new ApiError(0, 'Network error during upload'))
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'))
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(form)
  })
}
