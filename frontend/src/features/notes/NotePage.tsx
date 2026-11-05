import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Pin, Share2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, api } from '../../api/client'
import type { Note } from '../../api/types'
import { useSheets, failed, itemMenu, refreshItems, setPinned } from '../items/actions'
import { useCollections } from '../items/sheets'
import { MarkdownEditor } from '../markdown/Editor'
import { MenuButton } from '../../ui/Menu'
import { timeAgo } from '../format'

const SAVE_DELAY = 700
type Status = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error'
const LABEL: Record<Status, string> = { saved: 'Saved', dirty: 'Unsaved', saving: 'Saving...', conflict: 'Conflict', error: 'Not saved' }

/** Mounted fresh per note, so its drafts can never land on another note. */
function NoteEditor({ note }: { note: Note }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: collections = [] } = useCollections()
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const [status, setStatus] = useState<Status>('saved')
  const draft = useRef({ title: note.title, body: note.body })
  const saved = useRef({ title: note.title, body: note.body })
  const version = useRef(note.version)
  const timer = useRef<number | undefined>(undefined)
  const saving = useRef(false)

  const save = useCallback(async (overwrite = false): Promise<void> => {
    window.clearTimeout(timer.current)
    if (saving.current) return
    const current = { ...draft.current }
    if (current.title === saved.current.title && current.body === saved.current.body) { setStatus('saved'); return }
    if (!current.title.trim()) return
    saving.current = true
    setStatus('saving')
    try {
      const next = await api.patchNote(note.id, { ...current, version: overwrite ? undefined : version.current })
      version.current = next.version
      saved.current = current
      qc.setQueryData(['note', note.id], next)
      void refreshItems()
      saving.current = false
      // Typing carried on while that was in flight.
      if (draft.current.title !== current.title || draft.current.body !== current.body) void save()
      else setStatus('saved')
    } catch (err) {
      saving.current = false
      setStatus(err instanceof ApiError && err.status === 409 ? 'conflict' : 'error')
    }
  }, [note.id, qc])

  const schedule = () => {
    setStatus((s) => (s === 'conflict' ? s : 'dirty'))
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { if (statusRef.current !== 'conflict') void save() }, SAVE_DELAY)
  }
  const statusRef = useRef(status)
  statusRef.current = status

  // Leaving the page or closing the tab must not lose the last few keystrokes.
  useEffect(() => {
    const flush = () => {
      const current = draft.current
      if ((current.title === saved.current.title && current.body === saved.current.body) || statusRef.current === 'conflict' || !current.title.trim()) return
      void api.patchNote(note.id, { ...current, version: version.current }, true).then(() => refreshItems()).catch(() => undefined)
      saved.current = current
    }
    const onHide = () => { if (document.visibilityState === 'hidden') flush() }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
      window.clearTimeout(timer.current)
      flush()
    }
  }, [note.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); void save() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  const reload = async () => {
    const fresh = await api.note(note.id)
    draft.current = { title: fresh.title, body: fresh.body }
    saved.current = { title: fresh.title, body: fresh.body }
    version.current = fresh.version
    setTitle(fresh.title)
    setBody(fresh.body)
    setStatus('saved')
  }

  const collection = collections.find((c) => c.id === note.collection_id)
  const words = body.trim() ? body.trim().split(/\s+/).length : 0
  const live: Note = { ...note, title, body }

  return (
    <div className="note-page">
      <header className="doc-head">
        <Link to={collection ? `/c/${collection.id}` : '/notes'} className="icon-btn" aria-label="Back"><ArrowLeft size={20} /></Link>
        <input
          className="doc-title"
          aria-label="Note title"
          value={title}
          placeholder="Untitled"
          onChange={(e) => { setTitle(e.target.value); draft.current.title = e.target.value; schedule() }}
          onFocus={(e) => { if (e.target.value === 'Untitled') e.target.select() }}
        />
        <span className="doc-status" data-status={status} role="status">{LABEL[status]}</span>
        <button type="button" className="icon-btn" aria-pressed={note.pinned} aria-label={note.pinned ? 'Unpin' : 'Pin'} title={note.pinned ? 'Unpin' : 'Pin'} onClick={() => void setPinned([note.id], !note.pinned).then(() => qc.invalidateQueries({ queryKey: ['note', note.id] }))}><Pin size={18} /></button>
        <button type="button" className="icon-btn" aria-label="Share" title="Share" onClick={() => useSheets.setState({ share: live })}><Share2 size={18} /></button>
        <MenuButton label="Note options" entries={() => itemMenu(live).map((entry) => (entry && entry.label === 'Move to trash' ? { ...entry, run: () => { entry.run(); navigate('/notes') } } : entry))} />
      </header>
      {status === 'conflict' && (
        <div className="banner" role="alert">
          <span>This note changed somewhere else.</span>
          <button type="button" className="btn" onClick={() => void reload().catch(failed)}>Load theirs</button>
          <button type="button" className="btn" onClick={() => void save(true)}>Keep mine</button>
        </div>
      )}
      <MarkdownEditor
        label="Note text"
        value={body}
        placeholder="Write in plain text or markdown. Paste or drop images right here."
        onChange={(next) => { setBody(next); draft.current.body = next; schedule() }}
        extra={<span className="hint editor-count">{words} word{words === 1 ? '' : 's'} · {timeAgo(note.updated_at)}</span>}
      />
    </div>
  )
}

export function NotePage() {
  const { id = '' } = useParams()
  const { data, isError } = useQuery({ queryKey: ['note', id], queryFn: () => api.note(id), staleTime: 0, refetchOnWindowFocus: false })
  if (isError) return <div className="page"><div className="empty"><p>This note could not be opened.</p><Link className="btn" to="/notes">All notes</Link></div></div>
  return data ? <NoteEditor key={id} note={data} /> : null
}
