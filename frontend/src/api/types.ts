export type AuthStatus = 'disabled' | 'unavailable' | 'ok'
export type Kind = 'note' | 'board' | 'file'

export interface User { id: number; name: string }

export interface Session {
  mode: 'global' | 'scoped'
  auth_status: AuthStatus
  user: User | null
  allow_signup: boolean
  max_upload_mb: number
  quota_mb: number
  is_admin: boolean
}

export interface Collection {
  id: string
  parent_id: string | null
  name: string
  color: string | null
  icon: string | null
  position: number
  item_count: number
}

export interface FileMeta { filename: string; mime: string; size: number; inline: boolean }

export interface Item {
  id: string
  kind: Kind
  title: string
  snippet: string
  collection_id: string | null
  pinned: boolean
  version: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  file: FileMeta | null
  card_count: number | null
}

export interface ItemList { items: Item[]; total: number }
export interface Note extends Item { body: string }

export interface Card {
  id: number
  column_id: number
  title: string
  body: string
  labels: string[]
  due_date: string | null
  done: boolean
  color: string | null
  position: number
  updated_at: string
}

export interface Column { id: number; title: string; color: string | null; position: number; cards: Card[] }
export interface Board extends Item { body: string; columns: Column[] }

export interface UpcomingCard {
  id: number
  board_id: string
  board_title: string
  column_title: string
  title: string
  due_date: string | null
  done: boolean
}

export interface Share {
  id: number
  item_id: string
  token: string
  has_password: boolean
  expires_at: string | null
  max_views: number | null
  views: number
  created_at: string
}

export interface ShareInfo { title: string; kind: Kind; needs_password: boolean }

export interface SharedView {
  kind: Kind
  title: string
  updated_at: string
  body: string
  columns: Column[] | null
  file: FileMeta | null
}

export interface Secret {
  id: string
  label: string
  max_views: number
  views: number
  expires_at: string
  created_at: string
  active: boolean
  has_passphrase: boolean
}

export interface SecretInfo { has_passphrase: boolean; salt: string | null; views_left: number; expires_at: string }
export interface SecretPayload { ciphertext: string; iv: string; views_left: number }

export interface Post {
  id: number
  author_id: number
  author_name: string
  title: string
  body: string
  category: string
  pinned: boolean
  locked: boolean
  comment_count: number
  created_at: string
  updated_at: string
  activity_at: string
}

export interface Comment {
  id: number
  post_id: number
  author_id: number
  author_name: string
  body: string
  created_at: string
  updated_at: string
}

export interface PostDetail extends Post { comments: Comment[] }
export interface PostList { posts: Post[]; total: number; categories: string[] }

export interface SearchHit {
  type: Kind | 'card' | 'collection'
  id: string
  title: string
  snippet: string
  board_id: string | null
}

export interface Usage { used: number; quota: number; notes: number; boards: number; files: number; trash: number }
export interface PreferencesEnvelope { data: Record<string, unknown> | null }
