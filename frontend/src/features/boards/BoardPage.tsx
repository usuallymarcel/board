import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCorners, pointerWithin, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Calendar, Check, CheckSquare, GripVertical, MoveRight, Pencil, Pin, Plus, Search, Share2, Trash2, X } from 'lucide-react'
import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, type CardPatch } from '../../api/client'
import type { Board, Card, Column } from '../../api/types'
import { ColorRow } from '../collections/CollectionSheet'
import { dueState, formatDue, labelHue } from '../format'
import { failed, itemMenu, refreshItems, setPinned, useSheets } from '../items/actions'
import { useCollections } from '../items/sheets'
import { taskProgress } from '../markdown/tasks'
import { confirmAction } from '../../ui/dialogs'
import { InlineText } from '../../ui/InlineText'
import { MenuButton, contextMenu, type MenuEntries } from '../../ui/Menu'
import { toast } from '../../ui/primitives'
import { CardSheet } from './CardSheet'

const cardKey = (id: number) => `card-${id}`
const columnKey = (id: number) => `col-${id}`
const numberOf = (key: unknown) => Number(String(key).split('-')[1])

export function CardFace({ card, overlay = false }: { card: Card; overlay?: boolean }) {
  const tasks = taskProgress(card.body)
  return (
    <div className="card-face" data-done={card.done} data-overlay={overlay} style={card.color ? { borderLeftColor: card.color } : undefined}>
      {card.labels.length > 0 && (
        <span className="card-labels">
          {card.labels.map((l) => <span key={l} className="label-chip" style={{ '--hue': labelHue(l) } as React.CSSProperties}>{l}</span>)}
        </span>
      )}
      <span className="card-title">{card.title}</span>
      {(card.due_date || tasks.total > 0 || card.body) && (
        <span className="card-meta">
          {card.due_date && <span className="due-chip" data-state={card.done ? 'later' : dueState(card.due_date)}><Calendar size={12} aria-hidden="true" /> {formatDue(card.due_date)}</span>}
          {tasks.total > 0 && <span className="task-count" data-complete={tasks.done === tasks.total}><CheckSquare size={12} aria-hidden="true" /> {tasks.done}/{tasks.total}</span>}
        </span>
      )}
    </div>
  )
}

function SortableCard({ card, hidden, onOpen, onToggle, menu }: {
  card: Card
  hidden: boolean
  onOpen: () => void
  onToggle: () => void
  menu: () => MenuEntries
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cardKey(card.id) })
  return (
    <li
      ref={setNodeRef}
      className="card"
      hidden={hidden}
      data-dragging={isDragging}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      onContextMenu={contextMenu(menu)}
    >
      <button type="button" className="card-open" {...attributes} {...listeners} aria-label={`Open ${card.title}`} onClick={onOpen}>
        <CardFace card={card} />
      </button>
      <button type="button" className="card-tick" role="checkbox" aria-checked={card.done} aria-label={`Done: ${card.title}`} onClick={onToggle}>
        {card.done && <Check size={13} strokeWidth={3} />}
      </button>
    </li>
  )
}

function AddCard({ onAdd }: { onAdd: (title: string) => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (text.trim()) onAdd(text.trim())
    setText('')
  }
  if (!open) return <button type="button" className="add-card" onClick={() => setOpen(true)}><Plus size={16} aria-hidden="true" /> Add card</button>
  return (
    <form className="add-card-form" onSubmit={submit}>
      <input
        autoFocus
        aria-label="New card title"
        placeholder="Card title"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { if (!text.trim()) setOpen(false) }}
        onKeyDown={(e) => { if (e.key === 'Escape') { setText(''); setOpen(false) } }}
      />
      <button type="submit" className="btn btn-primary">Add</button>
    </form>
  )
}

function BoardColumn({ column, columns, visible, onOpenCard, onToggleCard, onAddCard, onPatch, onRemove, cardMenu }: {
  column: Column
  columns: Column[]
  visible: (card: Card) => boolean
  onOpenCard: (card: Card) => void
  onToggleCard: (card: Card) => void
  onAddCard: (title: string) => void
  onPatch: (patch: { title?: string; color?: string | null }) => void
  onRemove: (moveTo?: number) => void
  cardMenu: (card: Card) => MenuEntries
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: columnKey(column.id) })
  const others = columns.filter((c) => c.id !== column.id)
  const menu = () => [
    {
      label: 'Colour', run: () => undefined,
      custom: <div className="menu-colors" key="colour"><ColorRow value={column.color} onChange={(color) => onPatch({ color })} /></div>,
    },
    ...others.map((other) => ({ label: `Delete, cards to ${other.title}`, Icon: MoveRight, disabled: column.cards.length === 0, run: () => onRemove(other.id) })),
    { label: column.cards.length ? 'Delete with its cards' : 'Delete column', Icon: Trash2, danger: true, run: () => onRemove() },
  ]
  return (
    <section
      ref={setNodeRef}
      className="column"
      data-dragging={isDragging}
      aria-label={column.title}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <header className="column-head" style={column.color ? { borderTopColor: column.color } : undefined}>
        <button type="button" className="column-grip" aria-label={`Move column ${column.title}`} {...attributes} {...listeners}><GripVertical size={15} /></button>
        <InlineText label="Column name" className="column-title" value={column.title} onSave={(title) => onPatch({ title })} />
        <span className="column-count">{column.cards.length}</span>
        <MenuButton label={`${column.title} options`} entries={menu} />
      </header>
      <SortableContext items={column.cards.map((c) => cardKey(c.id))} strategy={verticalListSortingStrategy}>
        <ul className="column-cards">
          {column.cards.map((card) => (
            <SortableCard
              key={card.id}
              card={card}
              hidden={!visible(card)}
              onOpen={() => onOpenCard(card)}
              onToggle={() => onToggleCard(card)}
              menu={() => cardMenu(card)}
            />
          ))}
        </ul>
      </SortableContext>
      <AddCard onAdd={onAddCard} />
    </section>
  )
}

function findColumn(columns: Column[], key: string) {
  if (key.startsWith('col-')) return columns.find((c) => c.id === numberOf(key))
  return columns.find((c) => c.cards.some((card) => card.id === numberOf(key)))
}

export function BoardPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const qc = useQueryClient()
  const key = ['board', id]
  const [filter, setFilter] = useState('')
  const [activeKey, setActiveKey] = useState<string | null>(null)
  // A refetch mid-drag would snap the card back.
  const { data: board, isError } = useQuery({ queryKey: key, queryFn: () => api.board(id), refetchInterval: activeKey ? false : 30_000 })
  const { data: collections = [] } = useCollections()
  const [addingColumn, setAddingColumn] = useState(false)
  const [columnName, setColumnName] = useState('')
  const dragFrom = useRef<number | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const columns = useMemo(() => board?.columns ?? [], [board])
  const openCardId = Number(params.get('card')) || null
  const openCard = columns.flatMap((c) => c.cards).find((c) => c.id === openCardId) ?? null
  const setOpenCard = (cardId: number | null) => setParams(cardId ? { card: String(cardId) } : {}, { replace: true })

  const setColumns = (update: (columns: Column[]) => Column[]) => {
    qc.setQueryData<Board>(key, (old) => (old ? { ...old, columns: update(old.columns) } : old))
  }
  const refetch = () => qc.invalidateQueries({ queryKey: key })
  const fail = (err: unknown) => { failed(err); void refetch() }
  const patchLocalCard = (cardId: number, patch: CardPatch) => setColumns((cols) => cols.map((col) => ({
    ...col, cards: col.cards.map((card) => (card.id === cardId ? { ...card, ...patch } : card)),
  })))

  const collisions: CollisionDetection = (args) => {
    if (String(args.active.id).startsWith('col-')) {
      return closestCorners({ ...args, droppableContainers: args.droppableContainers.filter((c) => String(c.id).startsWith('col-')) })
    }
    const inside = pointerWithin(args)
    return inside.length ? closestCorners({ ...args, droppableContainers: args.droppableContainers.filter((c) => inside.some((hit) => hit.id === c.id)) }) : closestCorners(args)
  }

  const onDragStart = ({ active }: DragStartEvent) => {
    const name = String(active.id)
    setActiveKey(name)
    dragFrom.current = findColumn(columns, name)?.id ?? null
  }

  // A card crossing columns moves in the cache as it goes, so the gap follows the pointer.
  const onDragOver = ({ active, over }: DragOverEvent) => {
    const from = String(active.id)
    if (!over || from.startsWith('col-')) return
    const source = findColumn(columns, from)
    const target = findColumn(columns, String(over.id))
    if (!source || !target || source.id === target.id) return
    const card = source.cards.find((c) => c.id === numberOf(from))
    if (!card) return
    const overIndex = target.cards.findIndex((c) => cardKey(c.id) === String(over.id))
    const index = overIndex >= 0 ? overIndex : target.cards.length
    setColumns((cols) => cols.map((col) => {
      if (col.id === source.id) return { ...col, cards: col.cards.filter((c) => c.id !== card.id) }
      if (col.id !== target.id) return col
      const cards = [...col.cards]
      cards.splice(index, 0, { ...card, column_id: col.id })
      return { ...col, cards }
    }))
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveKey(null)
    const from = String(active.id)
    if (!over) { void refetch(); return }
    if (from.startsWith('col-')) {
      const oldIndex = columns.findIndex((c) => columnKey(c.id) === from)
      const newIndex = columns.findIndex((c) => columnKey(c.id) === String(over.id))
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
      setColumns((cols) => arrayMove(cols, oldIndex, newIndex))
      api.moveColumn(numberOf(from), newIndex).catch(fail)
      return
    }
    const column = findColumn(columns, from)
    if (!column) return
    const oldIndex = column.cards.findIndex((c) => cardKey(c.id) === from)
    const overIndex = column.cards.findIndex((c) => cardKey(c.id) === String(over.id))
    const index = overIndex >= 0 ? overIndex : oldIndex
    if (index !== oldIndex) setColumns((cols) => cols.map((c) => (c.id === column.id ? { ...c, cards: arrayMove(c.cards, oldIndex, index) } : c)))
    if (index !== oldIndex || dragFrom.current !== column.id) api.moveCard(numberOf(from), column.id, index).catch(fail)
  }

  const addCard = (columnId: number, title: string) => {
    api.createCard(id, columnId, title).then((card) => {
      setColumns((cols) => cols.map((c) => (c.id === columnId ? { ...c, cards: [...c.cards, card] } : c)))
      void refreshItems()
    }, fail)
  }

  const moveCardTo = (card: Card, columnId: number) => {
    setColumns((cols) => cols.map((col) => {
      if (col.id === card.column_id) return { ...col, cards: col.cards.filter((c) => c.id !== card.id) }
      if (col.id === columnId) return { ...col, cards: [...col.cards, { ...card, column_id: columnId }] }
      return col
    }))
    const target = columns.find((c) => c.id === columnId)
    api.moveCard(card.id, columnId, target?.cards.length ?? 0).catch(fail)
  }

  const removeCard = (card: Card) => {
    setColumns((cols) => cols.map((c) => ({ ...c, cards: c.cards.filter((x) => x.id !== card.id) })))
    if (openCardId === card.id) setOpenCard(null)
    api.deleteCard(card.id).then(() => {
      void refreshItems()
      toast('Card deleted')
    }, fail)
  }

  const patchCard = (card: Card, patch: CardPatch) => {
    patchLocalCard(card.id, patch)
    api.patchCard(card.id, patch).catch(fail)
  }

  const patchColumn = (columnId: number, patch: { title?: string; color?: string | null }) => {
    setColumns((cols) => cols.map((c) => (c.id === columnId ? { ...c, ...patch } : c)))
    api.patchColumn(columnId, patch).catch(fail)
  }

  const removeColumn = async (column: Column, moveTo?: number) => {
    if (!moveTo && column.cards.length > 0) {
      const ok = await confirmAction({ title: `Delete ${column.title}?`, body: `Its ${column.cards.length} card${column.cards.length === 1 ? '' : 's'} will be deleted too.`, action: 'Delete' })
      if (!ok) return
    }
    await api.deleteColumn(column.id, moveTo).catch(fail)
    await refetch()
  }

  const addColumn = (e: FormEvent) => {
    e.preventDefault()
    const title = columnName.trim()
    if (!title) return
    setColumnName('')
    api.createColumn(id, title).then(refetch, fail)
  }

  const cardMenu = (card: Card) => [
    { label: 'Open', Icon: Pencil, run: () => setOpenCard(card.id) },
    { label: card.done ? 'Mark not done' : 'Mark done', Icon: Check, run: () => patchCard(card, { done: !card.done }) },
    ...columns.filter((c) => c.id !== card.column_id).map((c) => ({ label: `Move to ${c.title}`, Icon: MoveRight, run: () => moveCardTo(card, c.id) })),
    { label: 'Delete card', Icon: Trash2, danger: true, run: () => removeCard(card) },
  ]

  if (isError) return <div className="page"><div className="empty"><p>This board could not be opened.</p><Link className="btn" to="/boards">All boards</Link></div></div>
  if (!board) return null

  const term = filter.trim().toLowerCase()
  const visible = (card: Card) => !term || card.title.toLowerCase().includes(term) || card.body.toLowerCase().includes(term) || card.labels.some((l) => l.toLowerCase().includes(term))
  const activeCard = activeKey?.startsWith('card-') ? columns.flatMap((c) => c.cards).find((c) => c.id === numberOf(activeKey)) : undefined
  const collection = collections.find((c) => c.id === board.collection_id)

  return (
    <div className="board-page">
      <header className="doc-head">
        <Link to={collection ? `/c/${collection.id}` : '/boards'} className="icon-btn" aria-label="Back"><ArrowLeft size={20} /></Link>
        <InlineText
          label="Board title"
          className="doc-title"
          value={board.title}
          onSave={(title) => {
            qc.setQueryData<Board>(key, { ...board, title })
            api.patchBoard(id, { title }).then(() => refreshItems(), fail)
          }}
        />
        <div className="search-field board-filter">
          <Search size={15} aria-hidden="true" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter cards" aria-label="Filter cards" />
          {filter && <button type="button" aria-label="Clear filter" onClick={() => setFilter('')}><X size={15} /></button>}
        </div>
        <button type="button" className="icon-btn" aria-pressed={board.pinned} aria-label={board.pinned ? 'Unpin' : 'Pin'} onClick={() => void setPinned([id], !board.pinned).then(refetch)}><Pin size={18} /></button>
        <button type="button" className="icon-btn" aria-label="Share" title="Share" onClick={() => useSheets.setState({ share: board })}><Share2 size={18} /></button>
        <MenuButton label="Board options" entries={() => itemMenu(board).map((entry) => (entry && entry.label === 'Move to trash' ? { ...entry, run: () => { entry.run(); navigate('/boards') } } : entry))} />
      </header>
      <DndContext sensors={sensors} collisionDetection={collisions} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { setActiveKey(null); void refetch() }}>
        <div className="columns">
          <SortableContext items={columns.map((c) => columnKey(c.id))} strategy={horizontalListSortingStrategy}>
            {columns.map((column) => (
              <BoardColumn
                key={column.id}
                column={column}
                columns={columns}
                visible={visible}
                onOpenCard={(card) => setOpenCard(card.id)}
                onToggleCard={(card) => patchCard(card, { done: !card.done })}
                onAddCard={(title) => addCard(column.id, title)}
                onPatch={(patch) => patchColumn(column.id, patch)}
                onRemove={(moveTo) => void removeColumn(column, moveTo)}
                cardMenu={cardMenu}
              />
            ))}
          </SortableContext>
          <div className="column column-new">
            {addingColumn ? (
              <form onSubmit={addColumn}>
                <input autoFocus aria-label="New column name" placeholder="Column name" value={columnName} onChange={(e) => setColumnName(e.target.value)} onBlur={() => { if (!columnName.trim()) setAddingColumn(false) }} onKeyDown={(e) => { if (e.key === 'Escape') setAddingColumn(false) }} />
              </form>
            ) : <button type="button" className="add-card" onClick={() => setAddingColumn(true)}><Plus size={16} aria-hidden="true" /> Add column</button>}
          </div>
        </div>
        <DragOverlay>{activeCard ? <CardFace card={activeCard} overlay /> : null}</DragOverlay>
      </DndContext>
      {openCard && (
        <CardSheet
          key={openCard.id}
          card={openCard}
          columns={columns}
          onClose={() => setOpenCard(null)}
          onChange={(patch) => patchLocalCard(openCard.id, patch)}
          onMove={(columnId) => moveCardTo(openCard, columnId)}
          onDelete={() => removeCard(openCard)}
        />
      )}
    </div>
  )
}
