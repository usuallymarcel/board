import {
  ArrowDown, ArrowUp, ChevronRight, Files, Folder, FolderPlus, Home, KanbanSquare, KeyRound, Layers, LogIn, LogOut, Menu as MenuIcon,
  MessagesSquare, Pencil, Plus, Search, Settings, StickyNote, Trash2, Upload,
} from 'lucide-react'
import { useEffect, useState, type DragEvent } from 'react'
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { Collection } from '../api/types'
import { CollectionSheetHost, editCollection } from '../features/collections/CollectionSheet'
import { collectionTree } from '../features/collections/tree'
import { failed, moveItems, refreshItems } from '../features/items/actions'
import { ItemSheets, useCollections } from '../features/items/sheets'
import { DropZone, pickFiles } from '../features/items/upload'
import { ITEM_DRAG } from '../features/items/ItemCard'
import { SearchPalette, useSearchPalette } from '../features/items/SearchPalette'
import { confirmAction } from '../ui/dialogs'
import { MenuButton, contextMenu, openMenu, type MenuEntries } from '../ui/Menu'
import { Sheet } from '../ui/primitives'
import { canUsePrivate, useLogout, useReadySession } from './session'

const PRIVATE_NAV = [
  { to: '/', label: 'Home', Icon: Home, end: true },
  { to: '/all', label: 'Everything', Icon: Layers, end: false },
  { to: '/notes', label: 'Notes', Icon: StickyNote, end: false },
  { to: '/boards', label: 'Boards', Icon: KanbanSquare, end: false },
  { to: '/files', label: 'Files', Icon: Files, end: false },
  { to: '/secrets', label: 'Secrets', Icon: KeyRound, end: false },
] as const

export function newNote(collectionId: string | null, navigate: (to: string) => void) {
  void api.createNote({ collection_id: collectionId }).then(async (note) => { await refreshItems(); navigate(`/notes/${note.id}`) }, failed)
}

export function newBoard(collectionId: string | null, navigate: (to: string) => void) {
  void api.createBoard({ collection_id: collectionId }).then(async (board) => { await refreshItems(); navigate(`/boards/${board.id}`) }, failed)
}

export function useCurrentCollection() {
  return useMatch('/c/:id')?.params.id ?? null
}

export function createEntries(collectionId: string | null, navigate: (to: string) => void): MenuEntries {
  return [
    { label: 'New note', Icon: StickyNote, run: () => newNote(collectionId, navigate) },
    { label: 'New board', Icon: KanbanSquare, run: () => newBoard(collectionId, navigate) },
    { label: 'Upload files', Icon: Upload, run: () => pickFiles(collectionId) },
    { label: 'New collection', Icon: FolderPlus, run: () => editCollection({ parent: collectionId }) },
    { label: 'New secret link', Icon: KeyRound, run: () => navigate('/secrets') },
  ]
}

function reorder(collection: Collection, siblings: Collection[], delta: -1 | 1) {
  const ids = siblings.map((c) => c.id)
  const at = ids.indexOf(collection.id)
  const to = at + delta
  if (to < 0 || to >= ids.length) return
  ids.splice(at, 1)
  ids.splice(to, 0, collection.id)
  void api.reorderCollections(collection.parent_id, ids).then(refreshItems, failed)
}

async function removeCollection(collection: Collection, navigate: (to: string) => void, inside: boolean) {
  const ok = await confirmAction({
    title: `Delete ${collection.name}?`,
    body: 'Everything inside moves up one level. Nothing is deleted except the collection.',
    action: 'Delete collection',
  })
  if (!ok) return
  await api.deleteCollection(collection.id).then(refreshItems, failed)
  if (inside) navigate('/all')
}

function collectionMenu(collection: Collection, all: Collection[], navigate: (to: string) => void, inside: boolean): MenuEntries {
  const siblings = all.filter((c) => c.parent_id === collection.parent_id)
  const at = siblings.findIndex((c) => c.id === collection.id)
  return [
    { label: 'Edit', Icon: Pencil, run: () => editCollection({ edit: collection }) },
    { label: 'New collection inside', Icon: FolderPlus, run: () => editCollection({ parent: collection.id }) },
    { label: 'Move up', Icon: ArrowUp, disabled: at <= 0, run: () => reorder(collection, siblings, -1) },
    { label: 'Move down', Icon: ArrowDown, disabled: at >= siblings.length - 1, run: () => reorder(collection, siblings, 1) },
    { label: 'Delete collection', Icon: Trash2, danger: true, run: () => void removeCollection(collection, navigate, inside) },
  ]
}

export function useCollectionMenu() {
  const navigate = useNavigate()
  const { data = [] } = useCollections()
  const current = useCurrentCollection()
  return (collection: Collection) => collectionMenu(collection, data, navigate, current === collection.id)
}

const COLLAPSED_KEY = 'board.collapsed'

function CollectionTree({ onNavigate }: { onNavigate?: () => void }) {
  const { data = [] } = useCollections()
  const menuFor = useCollectionMenu()
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[]))
  const [target, setTarget] = useState<string | null>(null)

  const toggle = (id: string) => {
    const next = new Set(collapsed)
    if (!next.delete(id)) next.add(id)
    setCollapsed(next)
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))
  }

  const accepts = (e: DragEvent) => e.dataTransfer.types.includes(ITEM_DRAG) || e.dataTransfer.types.includes('application/x-board-collection')

  const drop = (e: DragEvent, parent: string | null) => {
    e.preventDefault()
    e.stopPropagation()
    setTarget(null)
    const items = e.dataTransfer.getData(ITEM_DRAG)
    if (items) { void moveItems(JSON.parse(items) as string[], parent); return }
    const moved = e.dataTransfer.getData('application/x-board-collection')
    if (moved && moved !== parent) void api.patchCollection(moved, { parent_id: parent }).then(refreshItems, failed)
  }

  return (
    <div className="tree">
      <div
        className="tree-head"
        data-over={target === 'root'}
        onDragOver={(e) => { if (accepts(e)) { e.preventDefault(); setTarget('root') } }}
        onDragLeave={() => setTarget(null)}
        onDrop={(e) => drop(e, null)}
      >
        <span>Collections</span>
        <button type="button" className="tree-add" aria-label="New collection" title="New collection" onClick={() => editCollection({ parent: null })}><Plus size={16} /></button>
      </div>
      {data.length === 0 && <button type="button" className="tree-empty" onClick={() => editCollection({ parent: null })}>Group things into a collection</button>}
      {collectionTree(data, collapsed).map(({ collection, depth, hasChildren }) => (
        <div
          key={collection.id}
          className="tree-row"
          data-over={target === collection.id}
          style={{ paddingLeft: depth * 14 }}
          draggable
          onDragStart={(e) => { e.dataTransfer.setData('application/x-board-collection', collection.id); e.dataTransfer.effectAllowed = 'move' }}
          onDragOver={(e) => { if (accepts(e)) { e.preventDefault(); setTarget(collection.id) } }}
          onDragLeave={() => setTarget(null)}
          onDrop={(e) => drop(e, collection.id)}
          onContextMenu={contextMenu(() => menuFor(collection))}
        >
          {hasChildren ? (
            <button type="button" className="tree-toggle" aria-expanded={!collapsed.has(collection.id)} aria-label={`Toggle ${collection.name}`} onClick={() => toggle(collection.id)}>
              <ChevronRight size={14} />
            </button>
          ) : <span className="tree-toggle" />}
          <NavLink to={`/c/${collection.id}`} onClick={onNavigate}>
            <span className="tree-icon" style={collection.color ? { color: collection.color } : undefined}>
              {collection.icon ?? <Folder size={16} aria-hidden="true" />}
            </span>
            <span className="tree-name">{collection.name}</span>
            <span className="tree-count">{collection.item_count || ''}</span>
          </NavLink>
          <span className="tree-menu"><MenuButton label={`${collection.name} options`} entries={() => menuFor(collection)} /></span>
        </div>
      ))}
    </div>
  )
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const session = useReadySession()
  const signedIn = canUsePrivate(session)
  return (
    <nav>
      {signedIn && PRIVATE_NAV.map(({ to, label, Icon, end }) => (
        <NavLink key={to} to={to} end={end} onClick={onNavigate}><Icon size={18} aria-hidden="true" /> {label}</NavLink>
      ))}
      <NavLink to="/forum" onClick={onNavigate}><MessagesSquare size={18} aria-hidden="true" /> Forum</NavLink>
      {signedIn && <NavLink to="/trash" onClick={onNavigate}><Trash2 size={18} aria-hidden="true" /> Trash</NavLink>}
      <NavLink to="/settings" onClick={onNavigate}><Settings size={18} aria-hidden="true" /> Settings</NavLink>
    </nav>
  )
}

function AccountRow() {
  const session = useReadySession()
  const logout = useLogout()
  const { pathname } = useLocation()
  if (session.user) {
    return (
      <div className="sidebar-account">
        <span>{session.user.name}</span>
        <button type="button" className="icon-btn" onClick={() => logout.mutate()} aria-label="Sign out" title="Sign out"><LogOut size={18} /></button>
      </div>
    )
  }
  if (canUsePrivate(session)) return null
  return <Link className="btn sidebar-signin" to={`/login?next=${encodeURIComponent(pathname)}`}><LogIn size={16} aria-hidden="true" /> Sign in</Link>
}

function NewButton() {
  const navigate = useNavigate()
  const collection = useCurrentCollection()
  return (
    <MenuButton label="Create new" entries={() => createEntries(collection, navigate)}>
      <Plus size={17} aria-hidden="true" /> New
    </MenuButton>
  )
}

function Sidebar() {
  const session = useReadySession()
  const signedIn = canUsePrivate(session)
  return (
    <aside className="sidebar" aria-label="Main">
      <Link to="/" className="wordmark"><img src="/icon.svg" alt="" width="26" height="26" /> Board</Link>
      {signedIn && (
        <div className="sidebar-actions">
          <NewButton />
          <button type="button" className="btn sidebar-search" onClick={() => useSearchPalette.setState({ open: true })}>
            <Search size={16} aria-hidden="true" /> Search <kbd>Ctrl K</kbd>
          </button>
        </div>
      )}
      <div className="sidebar-scroll">
        <NavLinks />
        {signedIn && <CollectionTree />}
      </div>
      <AccountRow />
    </aside>
  )
}

function BottomNav() {
  const session = useReadySession()
  const signedIn = canUsePrivate(session)
  const navigate = useNavigate()
  const collection = useCurrentCollection()
  const [menu, setMenu] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => setMenu(false), [pathname])
  return (
    <>
      <nav className="bottom-nav" aria-label="Main">
        <NavLink to={signedIn ? '/' : '/forum'} end><Home size={22} aria-hidden="true" /><span>Home</span></NavLink>
        <button type="button" onClick={() => useSearchPalette.setState({ open: true })} disabled={!signedIn}><Search size={22} aria-hidden="true" /><span>Search</span></button>
        <NavLink to="/forum"><MessagesSquare size={22} aria-hidden="true" /><span>Forum</span></NavLink>
        <button type="button" onClick={() => setMenu(true)}><MenuIcon size={22} aria-hidden="true" /><span>Menu</span></button>
        {signedIn && (
          <button
            type="button"
            className="nav-add"
            aria-label="Create new"
            onClick={(e) => { const box = e.currentTarget.getBoundingClientRect(); openMenu(createEntries(collection, navigate), box.right, box.top - 8) }}
          >
            <Plus size={24} />
          </button>
        )}
      </nav>
      {menu && (
        <Sheet title="Menu" onClose={() => setMenu(false)}>
          <div className="mobile-menu">
            <NavLinks onNavigate={() => setMenu(false)} />
            {signedIn && <CollectionTree onNavigate={() => setMenu(false)} />}
            <AccountRow />
          </div>
        </Sheet>
      )}
    </>
  )
}

export function Shell() {
  const session = useReadySession()
  const signedIn = canUsePrivate(session)
  const collection = useCurrentCollection()
  const { pathname } = useLocation()
  // Dropping onto a note's editor attaches to the note; the page-wide target stays out of the way.
  const editing = /^\/(notes|boards|forum)\//.test(pathname)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k' && signedIn) {
        e.preventDefault()
        useSearchPalette.setState({ open: true })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [signedIn])
  return (
    <div className="shell">
      <Sidebar />
      <main className="main"><Outlet /></main>
      <BottomNav />
      {signedIn && !editing && <DropZone collectionId={collection} />}
      {signedIn && <ItemSheets />}
      {signedIn && <SearchPalette />}
      <CollectionSheetHost />
    </div>
  )
}
