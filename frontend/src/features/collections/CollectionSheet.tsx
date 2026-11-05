import { Check } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { create } from 'zustand'
import { api } from '../../api/client'
import type { Collection } from '../../api/types'
import { COLORS } from '../format'
import { failed, refreshItems } from '../items/actions'
import { useCollections } from '../items/sheets'
import { Sheet } from '../../ui/primitives'
import { descendants } from './tree'

const ICONS = ['📁', '📌', '💡', '🏠', '💼', '🛠️', '📚', '🎯', '🧪', '🎨', '✈️', '💰']

type Target = { edit: Collection } | { parent: string | null }
export const useCollectionSheet = create<{ target: Target | null }>(() => ({ target: null }))
export const editCollection = (target: Target) => useCollectionSheet.setState({ target })

function Form({ target }: { target: Target }) {
  const close = () => useCollectionSheet.setState({ target: null })
  const existing = 'edit' in target ? target.edit : null
  const { data = [] } = useCollections()
  const [name, setName] = useState(existing?.name ?? '')
  const [icon, setIcon] = useState(existing?.icon ?? '')
  const [color, setColor] = useState<string | null>(existing?.color ?? null)
  const [parent, setParent] = useState<string | null>(existing ? existing.parent_id : 'parent' in target ? target.parent : null)
  const blocked = existing ? descendants(data, existing.id) : new Set<string>()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    const body = { name: name.trim(), icon: icon || null, color, parent_id: parent }
    try {
      if (existing) await api.patchCollection(existing.id, body)
      else await api.createCollection(body)
      await refreshItems()
      close()
    } catch (err) { failed(err) }
  }

  return (
    <Sheet title={existing ? 'Edit collection' : 'New collection'} onClose={close}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label className="input-field">Name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </label>
        <label className="input-field">Inside
          <select value={parent ?? ''} onChange={(e) => setParent(e.target.value || null)}>
            <option value="">Top level</option>
            {data.filter((c) => !blocked.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <div className="field-col">
          <span className="label">Icon</span>
          <div className="icon-picks">
            <button type="button" aria-pressed={!icon} onClick={() => setIcon('')}>None</button>
            {ICONS.map((value) => <button key={value} type="button" aria-pressed={icon === value} onClick={() => setIcon(value)}>{value}</button>)}
            <input aria-label="Custom icon" placeholder="Other" value={ICONS.includes(icon) ? '' : icon} maxLength={8} onChange={(e) => setIcon(e.target.value)} />
          </div>
        </div>
        <div className="field-col">
          <span className="label">Colour</span>
          <ColorRow value={color} onChange={setColor} />
        </div>
        <button type="submit" className="btn btn-primary">{existing ? 'Save' : 'Create'}</button>
      </form>
    </Sheet>
  )
}

export function ColorRow({ value, onChange }: { value: string | null; onChange: (color: string | null) => void }) {
  return (
    <div className="swatches small">
      <button type="button" aria-label="No colour" aria-pressed={value === null} className="swatch-none" onClick={() => onChange(null)} />
      {COLORS.map((color) => (
        <button key={color} type="button" aria-label={`Colour ${color}`} aria-pressed={value === color} style={{ background: color }} onClick={() => onChange(color)}>
          {value === color && <Check size={14} strokeWidth={3} color="#0b0c0e" />}
        </button>
      ))}
    </div>
  )
}

export function CollectionSheetHost() {
  const target = useCollectionSheet((s) => s.target)
  return target ? <Form target={target} /> : null
}
