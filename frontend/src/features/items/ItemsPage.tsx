import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronRight, CheckSquare, FolderInput, Grid2x2, List, Pin, Plus, Search, Trash2, Upload, X, Folder } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, type ItemQuery } from '../../api/client'
import type { Kind } from '../../api/types'
import { createEntries, useCollectionMenu } from '../../app/Shell'
import { MenuButton, contextMenu } from '../../ui/Menu'
import { Segmented } from '../../ui/primitives'
import type { ItemSort, ItemView } from '../../settings/schema'
import { usePreferences } from '../../settings/store'
import { InlineText } from '../../ui/InlineText'
import { collectionTree, breadcrumbs } from '../collections/tree'
import { editCollection } from '../collections/CollectionSheet'
import { ItemCard } from './ItemCard'
import { failed, refreshItems, setPinned, trashItems, useSheets } from './actions'
import { useCollections } from './sheets'
import { pickFiles } from './upload'

type Filter = Kind | 'all' | 'pasted'
const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'note', label: 'Notes' }, { value: 'board', label: 'Boards' }, { value: 'file', label: 'Files' },
]
const SORTS: readonly { value: ItemSort; label: string }[] = [{ value: 'updated', label: 'Recent' }, { value: 'created', label: 'Created' }, { value: 'title', label: 'Name' }]
const VIEWS: readonly { value: ItemView; label: React.ReactNode }[] = [
  { value: 'grid', label: <Grid2x2 size={16} aria-label="Grid" /> }, { value: 'list', label: <List size={16} aria-label="List" /> },
]
const TITLES: Record<string, string> = { all: 'Everything', note: 'Notes', board: 'Boards', file: 'Files', pasted: 'Files' }
const PAGE = 100

export function ItemsPage({ kind }: { kind?: Kind }) {
  const { id: collectionId = null } = useParams()
  const navigate = useNavigate()
  const prefs = usePreferences((s) => s.prefs)
  const update = usePreferences((s) => s.update)
  const { data: collections = [] } = useCollections()
  const menuFor = useCollectionMenu()
  const collection = collections.find((c) => c.id === collectionId) ?? null
  const [filter, setFilter] = useState<Filter>(kind ?? 'all')
  const [text, setText] = useState('')
  const [term, setTerm] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selecting, setSelecting] = useState(false)
  useEffect(() => { setFilter(kind ?? 'all'); setSelected(new Set()); setSelecting(false); setText(''); setLimit(PAGE) }, [kind, collectionId])
  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(text.trim()), 200)
    return () => window.clearTimeout(timer)
  }, [text])

  const query: ItemQuery = {
    collection: collectionId ?? undefined,
    kind: filter === 'pasted' ? 'file' : filter === 'all' ? undefined : filter,
    inline: filter === 'pasted' ? true : undefined,
    sort: prefs.itemSort,
    q: term || undefined,
    limit,
  }
  const { data, isLoading, isError } = useQuery({ queryKey: ['items', query], queryFn: () => api.items(query), placeholderData: keepPreviousData })
  const items = data?.items ?? []
  const children = collectionTree(collections).filter((r) => r.collection.parent_id === collectionId && collectionId !== null).map((r) => r.collection)
  const selection = [...selected]
  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id))

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (!next.delete(id)) next.add(id)
    setSelected(next)
    setSelecting(next.size > 0)
  }
  const clear = () => { setSelected(new Set()); setSelecting(false) }

  return (
    <div className="page">
      {collection && (
        <nav className="crumbs" aria-label="Collection path">
          <Link to="/all">Everything</Link>
          {breadcrumbs(collections, collection.id).slice(0, -1).map((c) => (
            <span key={c.id}><ChevronRight size={14} aria-hidden="true" /><Link to={`/c/${c.id}`}>{c.name}</Link></span>
          ))}
        </nav>
      )}
      <header className="page-head">
        {collection ? (
          <h1 className="head-title">
            {collection.icon && <button type="button" className="head-icon" aria-label="Edit icon" onClick={() => editCollection({ edit: collection })}>{collection.icon}</button>}
            <InlineText label="Collection name" value={collection.name} onSave={(name) => api.patchCollection(collection.id, { name }).then(refreshItems, failed)} />
          </h1>
        ) : <h1>{TITLES[filter]}</h1>}
        <div className="head-actions">
          {collection && <MenuButton label="Collection options" entries={() => menuFor(collection)} />}
          {filter === 'file' || filter === 'pasted'
            ? <button type="button" className="btn btn-primary" onClick={() => pickFiles(collectionId)}><Upload size={16} aria-hidden="true" /> Upload</button>
            : <MenuButton label="Create new" entries={() => createEntries(collectionId, navigate)}><Plus size={17} aria-hidden="true" /> New</MenuButton>}
        </div>
      </header>

      <div className="toolbar">
        <div className="search-field">
          <Search size={16} aria-hidden="true" />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter" aria-label="Filter items" />
          {text && <button type="button" aria-label="Clear filter" onClick={() => setText('')}><X size={15} /></button>}
        </div>
        <Segmented label="Type" value={filter} options={filter === 'pasted' || filter === 'file' ? [...FILTERS, { value: 'pasted', label: 'Pasted' }] : FILTERS} onChange={setFilter} />
        <span className="toolbar-gap" />
        <Segmented label="Sort" value={prefs.itemSort} options={SORTS} onChange={(itemSort) => update({ itemSort })} />
        <Segmented label="View" value={prefs.itemView} options={VIEWS} onChange={(itemView) => update({ itemView })} />
        <button type="button" className="icon-btn" aria-pressed={selecting} aria-label="Select items" title="Select items" onClick={() => (selecting ? clear() : setSelecting(true))}><CheckSquare size={18} /></button>
      </div>

      {children.length > 0 && (
        <div className="folder-row">
          {children.map((c) => (
            <Link key={c.id} to={`/c/${c.id}`} className="folder" onContextMenu={contextMenu(() => menuFor(c))}>
              <span style={c.color ? { color: c.color } : undefined}>{c.icon ?? <Folder size={18} aria-hidden="true" />}</span> {c.name}
            </Link>
          ))}
        </div>
      )}

      {isError && <p className="form-error" role="alert">Could not load this. Try again in a moment.</p>}
      {!isLoading && !isError && items.length === 0 && children.length === 0 && (
        <div className="empty">
          <p>{term ? 'Nothing matches that.' : 'Nothing here yet.'}</p>
          {!term && <p className="hint">Use New, or drop files anywhere on this page.</p>}
        </div>
      )}
      <div className="items" data-view={prefs.itemView} data-density={prefs.density}>
        {items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            view={prefs.itemView}
            selected={selected.has(item.id)}
            selecting={selecting}
            onSelect={() => toggle(item.id)}
            dragIds={() => (selected.has(item.id) ? selection : [item.id])}
          />
        ))}
      </div>
      {data && data.total > items.length && (
        <button type="button" className="btn load-more" onClick={() => setLimit(Math.min(limit + PAGE, 1000))}>Show more ({data.total - items.length})</button>
      )}

      {selecting && (
        <div className="selection-bar" role="toolbar" aria-label="Selected items">
          <span>{selected.size} selected</span>
          <button type="button" className="text-btn" onClick={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)))}>{allSelected ? 'None' : 'All'}</button>
          <span className="toolbar-gap" />
          <button type="button" className="btn" disabled={!selected.size} onClick={() => useSheets.setState({ move: { ids: selection } })}><FolderInput size={16} aria-hidden="true" /> Move</button>
          <button type="button" className="btn" disabled={!selected.size} onClick={() => void setPinned(selection, !items.filter((i) => selected.has(i.id)).every((i) => i.pinned))}><Pin size={16} aria-hidden="true" /> Pin</button>
          <button type="button" className="btn btn-danger" disabled={!selected.size} onClick={() => { void trashItems(selection); clear() }}><Trash2 size={16} aria-hidden="true" /> Trash</button>
          <button type="button" className="icon-btn" aria-label="Stop selecting" onClick={clear}><X size={18} /></button>
        </div>
      )}
    </div>
  )
}
