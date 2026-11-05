import { useQuery } from '@tanstack/react-query'
import { Files, KanbanSquare, KeyRound, StickyNote } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import { newBoard, newNote } from '../../app/Shell'
import { useReadySession } from '../../app/session'
import { usePreferences } from '../../settings/store'
import { dueState, formatDue } from '../format'
import { ItemCard } from './ItemCard'
import { pickFiles } from './upload'

function Shelf({ title, query }: { title: string; query: Parameters<typeof api.items>[0] }) {
  const { data } = useQuery({ queryKey: ['items', query], queryFn: () => api.items(query) })
  const view = usePreferences((s) => s.prefs.itemView)
  if (!data?.items.length) return null
  return (
    <section className="home-section">
      <h2 className="section-title">{title}</h2>
      <div className="items" data-view={view}>
        {data.items.map((item) => <ItemCard key={item.id} item={item} view={view} selected={false} selecting={false} onSelect={() => undefined} dragIds={() => [item.id]} />)}
      </div>
    </section>
  )
}

function DueSoon() {
  const { data = [] } = useQuery({ queryKey: ['items', 'upcoming'], queryFn: api.upcoming })
  if (data.length === 0) return null
  return (
    <section className="home-section">
      <h2 className="section-title">Due</h2>
      <ul className="due-list">
        {data.slice(0, 8).map((card) => (
          <li key={card.id}>
            <Link to={`/boards/${card.board_id}?card=${card.id}`}>
              <span className="due-chip" data-state={dueState(card.due_date ?? '')}>{formatDue(card.due_date ?? '')}</span>
              <span className="due-title">{card.title}</span>
              <span className="hint">{card.board_title} · {card.column_title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function HomePage() {
  const session = useReadySession()
  const navigate = useNavigate()
  const prefs = usePreferences((s) => s.prefs)
  const { data: usage } = useQuery({ queryKey: ['usage'], queryFn: api.usage })
  const fresh = usage && usage.notes + usage.boards + usage.files === 0
  return (
    <div className="page">
      <header className="page-head"><h1>{session.user ? `Hello, ${session.user.name}` : 'Home'}</h1></header>
      <div className="quick">
        <button type="button" onClick={() => newNote(null, navigate)}><StickyNote size={20} aria-hidden="true" /> New note</button>
        <button type="button" onClick={() => newBoard(null, navigate)}><KanbanSquare size={20} aria-hidden="true" /> New board</button>
        <button type="button" onClick={() => pickFiles(null)}><Files size={20} aria-hidden="true" /> Upload files</button>
        <button type="button" onClick={() => navigate('/secrets')}><KeyRound size={20} aria-hidden="true" /> Share a secret</button>
      </div>
      {fresh && <p className="hint home-hint">Notes, boards and files show up here. Pin the ones you use most, and group them with collections in the sidebar.</p>}
      {prefs.homePinned && <Shelf title="Pinned" query={{ pinned: true, sort: prefs.itemSort, limit: 12 }} />}
      {prefs.homeDue && <DueSoon />}
      {prefs.homeRecent && <Shelf title="Recent" query={{ pinned: false, sort: 'updated', limit: 12 }} />}
    </div>
  )
}
