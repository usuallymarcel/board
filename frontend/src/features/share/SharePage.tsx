import { useQuery } from '@tanstack/react-query'
import { Download, FileText } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { ApiError, api, sharedFileUrl } from '../../api/client'
import type { SharedView } from '../../api/types'
import { CardFace } from '../boards/BoardPage'
import { formatBytes, timeAgo } from '../format'
import { Markdown } from '../markdown/Markdown'

function SharedContent({ view, token, grant }: { view: SharedView; token: string; grant: string | null }) {
  if (view.kind === 'note') return <div className="public-doc"><Markdown source={view.body} empty="This note is empty." /></div>
  if (view.kind === 'board') {
    return (
      <div className="columns shared-board">
        {view.columns?.map((column) => (
          <section key={column.id} className="column" aria-label={column.title}>
            <header className="column-head" style={column.color ? { borderTopColor: column.color } : undefined}>
              <span className="column-title static">{column.title}</span>
              <span className="column-count">{column.cards.length}</span>
            </header>
            <ul className="column-cards">{column.cards.map((card) => <li key={card.id} className="card"><CardFace card={card} /></li>)}</ul>
          </section>
        ))}
      </div>
    )
  }
  const file = view.file
  if (!file) return null
  const url = sharedFileUrl(token, grant)
  return (
    <div className="public-doc shared-file">
      {file.mime.startsWith('image/') && <img className="file-image" src={url} alt={view.title} />}
      {file.mime.startsWith('video/') && <video className="file-image" src={url} controls />}
      {file.mime.startsWith('audio/') && <audio src={url} controls />}
      {!/^(image|video|audio)\//.test(file.mime) && <FileText size={40} aria-hidden="true" />}
      <p className="hint">{file.filename} · {formatBytes(file.size)}</p>
      <a className="btn btn-primary" href={sharedFileUrl(token, grant, true)} download><Download size={16} aria-hidden="true" /> Download</a>
    </div>
  )
}

export function SharePage() {
  const { token = '' } = useParams()
  const { data: info, isError, isLoading } = useQuery({ queryKey: ['share-info', token], queryFn: () => api.shareInfo(token), retry: false, refetchOnWindowFocus: false })
  const [grant, setGrant] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const unlocked = Boolean(info) && (!info?.needs_password || grant !== null)
  const { data: view, isError: viewFailed } = useQuery({
    queryKey: ['share-view', token, grant],
    queryFn: () => api.sharedView(token, grant),
    enabled: unlocked,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity, // Each fetch counts as a view.
  })
  useEffect(() => { if (view) document.title = `${view.title} · Board` }, [view])

  const unlock = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      setGrant((await api.unlockShare(token, password)).grant)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not check that password.')
    }
  }

  if (isLoading) return null
  if (isError || viewFailed) {
    return <main className="public-page"><div className="public-card"><h1>Link not available</h1><p className="muted">It may have expired, or the owner may have removed it.</p></div></main>
  }
  if (info && !unlocked) {
    return (
      <main className="public-page">
        <form className="public-card stack" onSubmit={(e) => void unlock(e)}>
          <h1>{info.title}</h1>
          <label className="input-field">Password
            <input type="password" autoFocus required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary">Open</button>
        </form>
      </main>
    )
  }
  if (!view) return null
  return (
    <main className="public-view" data-kind={view.kind}>
      <header>
        <img src="/icon.svg" alt="" width="26" height="26" />
        <h1>{view.title}</h1>
        <span className="hint">Updated {timeAgo(view.updated_at)}</span>
      </header>
      <SharedContent view={view} token={token} grant={grant} />
    </main>
  )
}
