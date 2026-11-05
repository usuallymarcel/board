import { useQuery } from '@tanstack/react-query'
import { Folder, KanbanSquare, Search } from 'lucide-react'
import { useEffect, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { create } from 'zustand'
import { api } from '../../api/client'
import type { SearchHit } from '../../api/types'
import { itemIcon } from './ItemCard'
import { useSheets } from './actions'

export const useSearchPalette = create<{ open: boolean }>(() => ({ open: false }))

function hitIcon(hit: SearchHit) {
  if (hit.type === 'collection') return Folder
  if (hit.type === 'card') return KanbanSquare
  return itemIcon({ kind: hit.type, file: null })
}

function Palette() {
  const close = () => useSearchPalette.setState({ open: false })
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [term, setTerm] = useState('')
  const [active, setActive] = useState(0)
  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(text.trim()), 180)
    return () => window.clearTimeout(timer)
  }, [text])
  const { data = [] } = useQuery({ queryKey: ['search', term], queryFn: () => api.search(term), enabled: term.length > 0 })
  useEffect(() => setActive(0), [data])

  const open = async (hit: SearchHit) => {
    close()
    if (hit.type === 'collection') navigate(`/c/${hit.id}`)
    else if (hit.type === 'note') navigate(`/notes/${hit.id}`)
    else if (hit.type === 'board') navigate(`/boards/${hit.id}`)
    else if (hit.type === 'card') navigate(`/boards/${hit.board_id}?card=${hit.id}`)
    else {
      const list = await api.items({ kind: 'file', q: hit.title, limit: 20 })
      const item = list.items.find((i) => i.id === hit.id)
      if (item) useSheets.setState({ file: item })
    }
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, data.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { const hit = data[active]; if (hit) void open(hit) }
  }

  return createPortal(
    <div className="dialog-backdrop palette-backdrop" onClick={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search">
        <div className="palette-input">
          <Search size={18} aria-hidden="true" />
          <input autoFocus value={text} placeholder="Search notes, boards, cards and files" aria-label="Search" onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
        </div>
        {term && data.length === 0 && <p className="palette-empty">Nothing found.</p>}
        <ul>
          {data.map((hit, index) => {
            const Icon = hitIcon(hit)
            return (
              <li key={`${hit.type}-${hit.id}`}>
                <button type="button" data-active={index === active} onMouseEnter={() => setActive(index)} onClick={() => void open(hit)}>
                  <Icon size={17} aria-hidden="true" />
                  <span className="palette-text">
                    <span>{hit.title}</span>
                    {hit.snippet && <span className="hint">{hit.snippet}</span>}
                  </span>
                  <span className="palette-type">{hit.type}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>,
    document.body,
  )
}

export function SearchPalette() {
  return useSearchPalette((s) => s.open) ? <Palette /> : null
}
