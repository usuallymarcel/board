import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Lock, MessageCircle, Pencil, Pin, Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../../api/client'
import { canUsePrivate, useReadySession } from '../../app/session'
import { timeAgo } from '../format'

const PAGE = 30

export function ForumPage() {
  const session = useReadySession()
  const [params, setParams] = useSearchParams()
  const category = params.get('category') ?? undefined
  const [text, setText] = useState('')
  const [term, setTerm] = useState('')
  const [limit, setLimit] = useState(PAGE)
  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(text.trim()), 200)
    return () => window.clearTimeout(timer)
  }, [text])
  const query = { q: term || undefined, category, limit }
  const { data } = useQuery({ queryKey: ['forum', query], queryFn: () => api.posts(query), placeholderData: keepPreviousData })
  const posts = data?.posts ?? []
  const canPost = canUsePrivate(session) && session.auth_status !== 'unavailable'
  return (
    <div className="page narrow">
      <header className="page-head">
        <h1>Forum</h1>
        {canPost
          ? <Link className="btn btn-primary" to="/forum/new"><Pencil size={16} aria-hidden="true" /> New post</Link>
          : <Link className="btn" to="/login?next=/forum/new">Sign in to post</Link>}
      </header>
      <div className="toolbar">
        <div className="search-field">
          <Search size={16} aria-hidden="true" />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search posts" aria-label="Search posts" />
          {text && <button type="button" aria-label="Clear search" onClick={() => setText('')}><X size={15} /></button>}
        </div>
      </div>
      {data && data.categories.length > 1 && (
        <div className="chips" role="group" aria-label="Categories">
          <button type="button" aria-pressed={!category} onClick={() => setParams({})}>All</button>
          {data.categories.map((c) => <button key={c} type="button" aria-pressed={category === c} onClick={() => setParams({ category: c })}>{c}</button>)}
        </div>
      )}
      {data && posts.length === 0 && <div className="empty"><p>{term ? 'No posts match that.' : 'No posts yet.'}</p></div>}
      <ul className="post-list">
        {posts.map((post) => (
          <li key={post.id}>
            <Link to={`/forum/${post.id}`}>
              <span className="post-line">
                {post.pinned && <Pin size={14} aria-label="Pinned" />}
                {post.locked && <Lock size={14} aria-label="Locked" />}
                <span className="post-title">{post.title}</span>
              </span>
              <span className="hint post-meta">
                <span className="status-chip">{post.category}</span> {post.author_name} · {timeAgo(post.activity_at)}
                <span className="post-count"><MessageCircle size={14} aria-hidden="true" /> {post.comment_count}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {data && data.total > posts.length && <button type="button" className="btn load-more" onClick={() => setLimit(limit + PAGE)}>Show more</button>}
    </div>
  )
}
