import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Download, FileText, FolderInput, Inbox, Link as LinkIcon, Pencil, Share2, Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, fileUrl, mediaUrl } from '../../api/client'
import type { Collection, Item } from '../../api/types'
import { collectionTree } from '../collections/tree'
import { copyText, formatBytes, formatDate, timeAgo } from '../format'
import { Markdown } from '../markdown/Markdown'
import { Sheet, toast } from '../../ui/primitives'
import { download, failed, moveItems, refreshItems, renameItem, trashItems, useSheets } from './actions'

export const useCollections = (enabled = true) => useQuery({ queryKey: ['collections'], queryFn: api.collections, enabled })

const EXPIRY = [['', 'Never'], ['1', '1 hour'], ['24', '1 day'], ['168', '7 days'], ['720', '30 days']] as const

function MoveSheet({ ids }: { ids: string[] }) {
  const close = () => useSheets.setState({ move: null })
  const { data = [] } = useCollections()
  const qc = useQueryClient()
  const pick = (collection: Collection | null) => {
    const before = qc.getQueriesData<{ items: Item[] }>({ queryKey: ['items'] }).flatMap(([, list]) => list?.items ?? [])
    const undo = ids.map((id) => before.find((item) => item.id === id)?.collection_id ?? null)
    close()
    void moveItems(ids, collection?.id ?? null, undo)
  }
  return (
    <Sheet title={ids.length === 1 ? 'Move to' : `Move ${ids.length} items to`} onClose={close}>
      <ul className="pick-list">
        <li><button type="button" onClick={() => pick(null)}><Inbox size={18} aria-hidden="true" /> No collection</button></li>
        {collectionTree(data).map(({ collection, depth }) => (
          <li key={collection.id}>
            <button type="button" style={{ paddingLeft: 10 + depth * 18 }} onClick={() => pick(collection)}>
              <span className="tree-icon">{collection.icon ?? <FolderInput size={18} aria-hidden="true" />}</span> {collection.name}
            </button>
          </li>
        ))}
      </ul>
      {data.length === 0 && <p className="hint">No collections yet. Create one from the sidebar.</p>}
    </Sheet>
  )
}

function ShareSheet({ item }: { item: Item }) {
  const close = () => useSheets.setState({ share: null })
  const qc = useQueryClient()
  const key = ['shares', item.id]
  const { data = [] } = useQuery({ queryKey: key, queryFn: () => api.shares(item.id) })
  const [password, setPassword] = useState('')
  const [expiry, setExpiry] = useState('')
  const [views, setViews] = useState('')
  const link = (token: string) => `${window.location.origin}/share/${token}`
  const create = useMutation({
    mutationFn: () => api.createShare({
      item_id: item.id,
      password: password || undefined,
      expires_in_hours: expiry ? Number(expiry) : undefined,
      max_views: views ? Number(views) : undefined,
    }),
    onSuccess: async (share) => {
      setPassword('')
      await qc.invalidateQueries({ queryKey: key })
      toast(await copyText(link(share.token)) ? 'Link copied' : 'Link created')
    },
    onError: failed,
  })
  const remove = useMutation({ mutationFn: api.deleteShare, onSuccess: () => qc.invalidateQueries({ queryKey: key }), onError: failed })
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate() }
  return (
    <Sheet title={`Share ${item.title}`} onClose={close}>
      <p className="hint">Anyone with the link can view this, without an account. They cannot change it.</p>
      <form className="stack" onSubmit={submit}>
        <label className="input-field">Password (optional)
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <div className="form-row">
          <label className="input-field">Expires
            <select value={expiry} onChange={(e) => setExpiry(e.target.value)}>
              {EXPIRY.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="input-field">View limit
            <input type="number" min={1} placeholder="None" value={views} onChange={(e) => setViews(e.target.value)} />
          </label>
        </div>
        <button type="submit" className="btn btn-primary" disabled={create.isPending}><LinkIcon size={16} aria-hidden="true" /> Create link</button>
      </form>
      {data.length > 0 && <h3 className="sheet-sub">Active links</h3>}
      <ul className="share-list">
        {data.map((share) => (
          <li key={share.id}>
            <span className="share-text">
              <span className="share-url">{link(share.token)}</span>
              <span className="hint">
                {share.views}{share.max_views ? ` of ${share.max_views}` : ''} views
                {share.has_password && ' · password'}
                {share.expires_at && ` · until ${formatDate(share.expires_at)}`}
              </span>
            </span>
            <button type="button" className="icon-btn" aria-label="Copy link" onClick={() => void copyText(link(share.token)).then((ok) => toast(ok ? 'Link copied' : 'Could not copy'))}><Copy size={17} /></button>
            <button type="button" className="icon-btn" aria-label="Delete link" onClick={() => remove.mutate(share.id)}><Trash2 size={17} /></button>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}

const TEXT_FILE = /\.(md|markdown|txt|log|json|csv|ya?ml|toml|ini|py|js|ts|tsx|sh|sql|xml|html|css)$/i
const MAX_TEXT_PREVIEW = 512 * 1024

function TextPreview({ item, markdown }: { item: Item; markdown: boolean }) {
  const { data, isError } = useQuery({
    queryKey: ['file-text', item.id],
    queryFn: async () => {
      const res = await fetch(fileUrl(item.id))
      if (!res.ok) throw new Error('failed')
      return res.text()
    },
  })
  if (isError) return <p className="hint">Could not load a preview.</p>
  if (data === undefined) return null
  return markdown ? <Markdown source={data} /> : <pre className="file-text">{data}</pre>
}

function Preview({ item }: { item: Item }) {
  const file = item.file
  if (!file) return null
  const url = fileUrl(item.id)
  if (file.mime.startsWith('image/')) return <img className="file-image" src={url} alt={item.title} />
  if (file.mime.startsWith('video/')) return <video className="file-image" src={url} controls />
  if (file.mime.startsWith('audio/')) return <audio src={url} controls />
  if (TEXT_FILE.test(file.filename) && file.size <= MAX_TEXT_PREVIEW) return <TextPreview item={item} markdown={/\.(md|markdown)$/i.test(file.filename)} />
  return <div className="file-none"><FileText size={36} aria-hidden="true" /><p className="hint">No preview for this type.</p></div>
}

function FileSheet({ item }: { item: Item }) {
  const close = () => useSheets.setState({ file: null })
  const navigate = useNavigate()
  const file = item.file
  if (!file) return null
  const image = file.mime.startsWith('image/')
  const embed = async () => {
    await api.patchItem(item.id, { inline: true })
    await refreshItems()
    const link = `${image ? '!' : ''}[${file.filename}](${mediaUrl(item.id, file.filename)})`
    toast(await copyText(link) ? 'Markdown copied. Anyone with that link can now view this file.' : link)
  }
  const toNote = async () => {
    const text = await fetch(fileUrl(item.id)).then((r) => r.text())
    const note = await api.createNote({ title: item.title.replace(/\.[^.]+$/, ''), body: text, collection_id: item.collection_id })
    await refreshItems()
    close()
    navigate(`/notes/${note.id}`)
  }
  return (
    <Sheet title={item.title} onClose={close}>
      <div className="file-preview"><Preview item={item} /></div>
      <p className="hint">{formatBytes(file.size)} · {file.mime} · changed {timeAgo(item.updated_at)}</p>
      <div className="button-row">
        <button type="button" className="btn btn-primary" onClick={() => download(fileUrl(item.id, true))}><Download size={16} aria-hidden="true" /> Download</button>
        {file.mime === 'application/pdf' && <a className="btn" href={fileUrl(item.id)} target="_blank" rel="noreferrer">Open</a>}
        <button type="button" className="btn" onClick={() => useSheets.setState({ file: null, share: item })}><Share2 size={16} aria-hidden="true" /> Share</button>
        <button type="button" className="btn" onClick={() => void renameItem(item)}><Pencil size={16} aria-hidden="true" /> Rename</button>
        <button type="button" className="btn" onClick={() => useSheets.setState({ file: null, move: { ids: [item.id] } })}><FolderInput size={16} aria-hidden="true" /> Move</button>
        <button type="button" className="btn" onClick={() => void embed().catch(failed)}><Copy size={16} aria-hidden="true" /> Copy as markdown</button>
        {TEXT_FILE.test(file.filename) && <button type="button" className="btn" onClick={() => void toNote().catch(failed)}><FileText size={16} aria-hidden="true" /> Edit as note</button>}
        <button type="button" className="btn btn-danger" onClick={() => { close(); void trashItems([item.id]) }}><Trash2 size={16} aria-hidden="true" /> Trash</button>
      </div>
    </Sheet>
  )
}

export function ItemSheets() {
  const { move, share, file } = useSheets()
  // A sheet must not outlive a sign-out.
  useEffect(() => () => useSheets.setState({ move: null, share: null, file: null }), [])
  return (
    <>
      {move && <MoveSheet ids={move.ids} />}
      {share && <ShareSheet key={share.id} item={share} />}
      {file && <FileSheet key={file.id} item={file} />}
    </>
  )
}
