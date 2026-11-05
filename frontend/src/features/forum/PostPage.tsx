import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Lock, LockOpen, Pencil, Pin, PinOff, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../../api/client'
import type { Comment } from '../../api/types'
import { canUsePrivate, useReadySession } from '../../app/session'
import { timeAgo } from '../format'
import { failed } from '../items/actions'
import { MarkdownEditor } from '../markdown/Editor'
import { Markdown } from '../markdown/Markdown'
import { confirmAction } from '../../ui/dialogs'
import { MenuButton, type MenuEntries } from '../../ui/Menu'

function CommentRow({ comment, mine, moderator, onChanged }: { comment: Comment; mine: boolean; moderator: boolean; onChanged: () => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const save = async () => {
    if (!draft?.trim()) return
    await api.patchComment(comment.id, draft).catch(failed)
    setDraft(null)
    onChanged()
  }
  const remove = async () => {
    if (!await confirmAction({ title: 'Delete this comment?', body: 'This cannot be undone.', action: 'Delete' })) return
    await api.deleteComment(comment.id).catch(failed)
    onChanged()
  }
  const entries: MenuEntries = [
    mine && { label: 'Edit', Icon: Pencil, run: () => setDraft(comment.body) },
    { label: 'Delete', Icon: Trash2, danger: true, run: () => void remove() },
  ]
  return (
    <li className="comment">
      <div className="comment-head">
        <strong>{comment.author_name}</strong>
        <span className="hint">{timeAgo(comment.created_at)}{comment.updated_at !== comment.created_at ? ' · edited' : ''}</span>
        {(mine || moderator) && <MenuButton label="Comment options" entries={() => entries} />}
      </div>
      {draft === null ? <Markdown source={comment.body} /> : (
        <div className="stack">
          <MarkdownEditor compact label="Edit comment" value={draft} onChange={setDraft} />
          <div className="button-row">
            <button type="button" className="btn btn-primary" onClick={() => void save()}>Save</button>
            <button type="button" className="btn" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      )}
    </li>
  )
}

export function PostPage() {
  const { id } = useParams()
  const postId = Number(id)
  const session = useReadySession()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const key = ['forum-post', postId]
  const { data: post, isError } = useQuery({ queryKey: key, queryFn: () => api.post(postId), retry: false })
  const [comment, setComment] = useState('')
  const refresh = () => { void qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: ['forum'] }) }
  const send = useMutation({
    mutationFn: () => api.createComment(postId, comment),
    onSuccess: () => { setComment(''); refresh() },
    onError: failed,
  })
  const patch = useMutation({ mutationFn: (change: { pinned?: boolean; locked?: boolean }) => api.patchPost(postId, change), onSuccess: refresh, onError: failed })

  if (isError) return <div className="page narrow"><div className="empty"><p>This post is gone.</p><Link className="btn" to="/forum">Back to the forum</Link></div></div>
  if (!post) return null

  const me = session.user?.id ?? 0
  const signedIn = canUsePrivate(session) && session.auth_status !== 'unavailable'
  const mine = signedIn && post.author_id === me
  const moderator = session.is_admin
  const remove = async () => {
    if (!await confirmAction({ title: 'Delete this post?', body: 'Its comments go with it. This cannot be undone.', action: 'Delete' })) return
    await api.deletePost(postId).catch(failed)
    await qc.invalidateQueries({ queryKey: ['forum'] })
    navigate('/forum')
  }
  const entries: MenuEntries = [
    mine && { label: 'Edit', Icon: Pencil, run: () => navigate(`/forum/${postId}/edit`) },
    moderator && { label: post.pinned ? 'Unpin' : 'Pin', Icon: post.pinned ? PinOff : Pin, run: () => patch.mutate({ pinned: !post.pinned }) },
    moderator && { label: post.locked ? 'Unlock' : 'Lock', Icon: post.locked ? LockOpen : Lock, run: () => patch.mutate({ locked: !post.locked }) },
    (mine || moderator) && { label: 'Delete', Icon: Trash2, danger: true, run: () => void remove() },
  ]

  return (
    <div className="page narrow">
      <Link to="/forum" className="text-btn back-link"><ArrowLeft size={16} aria-hidden="true" /> Forum</Link>
      <article className="post">
        <header className="post-head">
          <div>
            <h1>{post.title}</h1>
            <p className="hint"><span className="status-chip">{post.category}</span> {post.author_name} · {timeAgo(post.created_at)}{post.updated_at !== post.created_at ? ' · edited' : ''}</p>
          </div>
          {(mine || moderator) && <MenuButton label="Post options" entries={() => entries} />}
        </header>
        <Markdown source={post.body} />
      </article>
      <section aria-label="Comments">
        <h2 className="section-title list-title">{post.comment_count} comment{post.comment_count === 1 ? '' : 's'}</h2>
        <ul className="comments">
          {post.comments.map((c) => <CommentRow key={c.id} comment={c} mine={signedIn && c.author_id === me} moderator={moderator} onChanged={refresh} />)}
        </ul>
        {post.locked && !moderator ? <p className="hint">This post is locked.</p> : signedIn ? (
          <form className="stack comment-form" onSubmit={(e) => { e.preventDefault(); if (comment.trim()) send.mutate() }}>
            <MarkdownEditor compact label="Your comment" value={comment} onChange={setComment} placeholder="Add a comment. Markdown and pasted images work." />
            <button type="submit" className="btn btn-primary" disabled={send.isPending || !comment.trim()}>Comment</button>
          </form>
        ) : <Link className="btn" to={`/login?next=/forum/${postId}`}>Sign in to comment</Link>}
      </section>
    </div>
  )
}
