import { CalendarX2, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { api, type CardPatch } from '../../api/client'
import type { Card, Column } from '../../api/types'
import { ColorRow } from '../collections/CollectionSheet'
import { labelHue } from '../format'
import { failed } from '../items/actions'
import { MarkdownEditor } from '../markdown/Editor'
import { Sheet, Switch } from '../../ui/primitives'

const SAVE_DELAY = 500

export function CardSheet({ card, columns, onClose, onChange, onMove, onDelete }: {
  card: Card
  columns: Column[]
  onClose: () => void
  onChange: (patch: CardPatch) => void
  onMove: (columnId: number) => void
  onDelete: () => void
}) {
  const [title, setTitle] = useState(card.title)
  const [body, setBody] = useState(card.body)
  const [label, setLabel] = useState('')
  const pending = useRef<CardPatch>({})
  const timer = useRef<number | undefined>(undefined)

  const flush = () => {
    window.clearTimeout(timer.current)
    const patch = pending.current
    if (Object.keys(patch).length === 0) return
    pending.current = {}
    void api.patchCard(card.id, patch).catch(failed)
  }
  const change = (patch: CardPatch) => {
    onChange(patch)
    pending.current = { ...pending.current, ...patch }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, SAVE_DELAY)
  }
  // Closing the sheet saves whatever is still waiting.
  useEffect(() => flush, [])

  const addLabel = () => {
    const text = label.trim()
    setLabel('')
    if (text && !card.labels.includes(text)) change({ labels: [...card.labels, text] })
  }
  const onLabelKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addLabel() }
  }

  return (
    <Sheet
      title="Card"
      onClose={onClose}
      actions={<button type="button" className="icon-btn" aria-label="Delete card" title="Delete card" onClick={onDelete}><Trash2 size={18} /></button>}
    >
      <div className="stack card-form">
        <input
          className="card-title-input"
          aria-label="Card title"
          value={title}
          onChange={(e) => { setTitle(e.target.value); if (e.target.value.trim()) change({ title: e.target.value.trim() }) }}
        />
        <div className="field-row">
          <span className="label">Done</span>
          <Switch label="Done" checked={card.done} onChange={(done) => change({ done })} />
        </div>
        <div className="form-row">
          <label className="input-field">Column
            <select value={card.column_id} onChange={(e) => onMove(Number(e.target.value))}>
              {columns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </label>
          <label className="input-field">Due
            <span className="date-field">
              <input type="date" value={card.due_date ?? ''} onChange={(e) => change({ due_date: e.target.value || null })} />
              {card.due_date && <button type="button" className="icon-btn" aria-label="Clear due date" onClick={() => change({ due_date: null })}><CalendarX2 size={17} /></button>}
            </span>
          </label>
        </div>
        <div className="field-col">
          <span className="label">Labels</span>
          <div className="label-edit">
            {card.labels.map((text) => (
              <span key={text} className="label-chip" style={{ '--hue': labelHue(text) } as React.CSSProperties}>
                {text}
                <button type="button" aria-label={`Remove ${text}`} onClick={() => change({ labels: card.labels.filter((l) => l !== text) })}><X size={12} /></button>
              </span>
            ))}
            <input aria-label="Add label" placeholder="Add label" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} onKeyDown={onLabelKey} onBlur={addLabel} />
          </div>
        </div>
        <div className="field-col">
          <span className="label">Colour</span>
          <ColorRow value={card.color} onChange={(color) => change({ color })} />
        </div>
        <MarkdownEditor compact label="Card description" value={body} placeholder="Details, checklists, pasted images..." onChange={(next) => { setBody(next); change({ body: next }) }} />
      </div>
    </Sheet>
  )
}
