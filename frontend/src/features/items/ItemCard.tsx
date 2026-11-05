import { Check, File, FileArchive, FileImage, FileText, FileVideo, KanbanSquare, Music, Pin, StickyNote, type LucideIcon } from 'lucide-react'
import type { DragEvent, MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { fileUrl } from '../../api/client'
import type { Item } from '../../api/types'
import { MenuButton, contextMenu } from '../../ui/Menu'
import { formatBytes, timeAgo } from '../format'
import { itemMenu, itemPath, useSheets } from './actions'

export const ITEM_DRAG = 'application/x-board-items'

function fileIcon(mime: string): LucideIcon {
  if (mime.startsWith('image/')) return FileImage
  if (mime.startsWith('video/')) return FileVideo
  if (mime.startsWith('audio/')) return Music
  if (mime.includes('zip') || mime.includes('tar') || mime.includes('compressed')) return FileArchive
  return mime.startsWith('text/') || mime === 'application/pdf' ? FileText : File
}

export const itemIcon = (item: Pick<Item, 'kind' | 'file'>): LucideIcon =>
  (item.kind === 'note' ? StickyNote : item.kind === 'board' ? KanbanSquare : fileIcon(item.file?.mime ?? ''))

const plainSnippet = (text: string) => text.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/[#>*_`~-]|\[( |x)\]/g, '').replace(/\s+/g, ' ').trim()

function detail(item: Item) {
  if (item.kind === 'file') return formatBytes(item.file?.size ?? 0)
  if (item.kind === 'board') return `${item.card_count ?? 0} card${item.card_count === 1 ? '' : 's'}`
  return timeAgo(item.updated_at)
}

export function ItemCard({ item, view, selected, selecting, onSelect, dragIds }: {
  item: Item
  view: 'grid' | 'list'
  selected: boolean
  selecting: boolean
  onSelect: () => void
  dragIds: () => string[]
}) {
  const navigate = useNavigate()
  const Icon = itemIcon(item)
  const open = () => {
    if (item.kind === 'file') useSheets.setState({ file: item })
    else navigate(itemPath(item))
  }
  const onClick = (e: MouseEvent) => {
    if (selecting || e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault()
      onSelect()
    } else if (item.kind === 'file') {
      e.preventDefault()
      open()
    }
  }
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(ITEM_DRAG, JSON.stringify(dragIds()))
    e.dataTransfer.effectAllowed = 'move'
  }
  const image = item.file?.mime.startsWith('image/')
  return (
    <article className="item" data-view={view} data-selected={selected} onContextMenu={contextMenu(() => itemMenu(item, open))}>
      <Link
        to={item.kind === 'file' ? '#' : itemPath(item)}
        className="item-link"
        draggable
        onDragStart={onDragStart}
        onClick={onClick}
        aria-label={item.title}
      >
        {view === 'grid' && image && <img className="item-thumb" src={fileUrl(item.id)} alt="" loading="lazy" />}
        <span className="item-head">
          <span className="item-kind" data-kind={item.kind}><Icon size={17} aria-hidden="true" /></span>
          <span className="item-title">{item.title}</span>
          {item.pinned && <Pin size={14} className="item-pin" aria-label="Pinned" />}
        </span>
        {view === 'grid' && !image && <span className="item-snippet">{item.kind === 'note' ? plainSnippet(item.snippet) : ''}</span>}
        <span className="item-meta">{detail(item)}{view === 'grid' && item.kind !== 'note' ? ` · ${timeAgo(item.updated_at)}` : ''}</span>
      </Link>
      <button type="button" className="item-check" role="checkbox" aria-checked={selected} aria-label={`Select ${item.title}`} onClick={onSelect}>
        {selected && <Check size={14} strokeWidth={3} />}
      </button>
      <span className="item-menu"><MenuButton label={`${item.title} options`} entries={() => itemMenu(item, open)} /></span>
    </article>
  )
}
