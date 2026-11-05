import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../../api/client'
import { failed } from '../items/actions'
import { MarkdownEditor } from '../markdown/Editor'

/** New post when there is no id in the route, otherwise edits that post. */
export function PostEditor() {
  const { id } = useParams()
  const postId = id ? Number(id) : null
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: post } = useQuery({ queryKey: ['forum-post', postId], queryFn: () => api.post(postId as number), enabled: postId !== null })
  const { data: list } = useQuery({ queryKey: ['forum', 'categories'], queryFn: () => api.posts({ limit: 1 }) })
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState('General')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (post) { setTitle(post.title); setBody(post.body); setCategory(post.category) }
  }, [post])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !body.trim()) return
    setBusy(true)
    try {
      const saved = postId === null ? await api.createPost({ title, body, category }) : await api.patchPost(postId, { title, body, category })
      await qc.invalidateQueries({ queryKey: ['forum'] })
      await qc.invalidateQueries({ queryKey: ['forum-post', saved.id] })
      navigate(`/forum/${saved.id}`)
    } catch (err) {
      failed(err)
      setBusy(false)
    }
  }

  return (
    <div className="page narrow">
      <Link to={postId ? `/forum/${postId}` : '/forum'} className="text-btn back-link"><ArrowLeft size={16} aria-hidden="true" /> Back</Link>
      <header className="page-head"><h1>{postId ? 'Edit post' : 'New post'}</h1></header>
      <p className="hint">Posts are public. Anyone can read them without an account.</p>
      <form className="stack post-form" onSubmit={(e) => void submit(e)}>
        <label className="input-field">Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required autoFocus />
        </label>
        <label className="input-field">Category
          <input value={category} list="forum-categories" onChange={(e) => setCategory(e.target.value)} maxLength={40} required />
          <datalist id="forum-categories">{list?.categories.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <MarkdownEditor label="Post text" value={body} onChange={setBody} placeholder="Write in markdown. Paste images right in." />
        <button type="submit" className="btn btn-primary" disabled={busy}>{postId ? 'Save' : 'Publish'}</button>
      </form>
    </div>
  )
}
