import { CheckCircle2, UploadCloud, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { ApiError, api, uploadFile } from '../../api/client'
import { queryClient } from '../../app/queryClient'
import { formatBytes } from '../format'

interface Upload {
  id: number
  name: string
  size: number
  progress: number
  status: 'active' | 'done' | 'failed'
  error?: string
  abort: AbortController
}

const useUploads = create<{ uploads: Upload[] }>(() => ({ uploads: [] }))
const patch = (id: number, change: Partial<Upload>) =>
  useUploads.setState((s) => ({ uploads: s.uploads.map((u) => (u.id === id ? { ...u, ...change } : u)) }))

const MARKDOWN = /\.(md|markdown|mdown)$/i
const MAX_NOTE_BYTES = 1_000_000
const PARALLEL = 3
let sequence = 0

async function send(file: File, collectionId: string | null, entry: Upload) {
  try {
    // Markdown files become notes, so they can be edited here and exported again.
    if (MARKDOWN.test(file.name) && file.size <= MAX_NOTE_BYTES) {
      await api.createNote({ title: file.name.replace(MARKDOWN, '').slice(0, 300) || 'Untitled', body: await file.text(), collection_id: collectionId })
    } else {
      await uploadFile(file, { collection_id: collectionId }, (progress) => patch(entry.id, { progress }), entry.abort.signal)
    }
    patch(entry.id, { status: 'done', progress: 1 })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      useUploads.setState((s) => ({ uploads: s.uploads.filter((u) => u.id !== entry.id) }))
      return
    }
    patch(entry.id, { status: 'failed', error: err instanceof ApiError ? err.message : 'Upload failed' })
  }
}

export async function uploadFiles(files: File[], collectionId: string | null) {
  const entries = files.map((file): [File, Upload] => [file, {
    id: ++sequence, name: file.name, size: file.size, progress: 0, status: 'active', abort: new AbortController(),
  }])
  useUploads.setState((s) => ({ uploads: [...s.uploads.filter((u) => u.status === 'active'), ...entries.map(([, e]) => e)] }))
  const queue = [...entries]
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) await send(next[0], collectionId, next[1])
  }))
  await queryClient.invalidateQueries({ queryKey: ['items'] })
  await queryClient.invalidateQueries({ queryKey: ['collections'] })
  await queryClient.invalidateQueries({ queryKey: ['usage'] })
}

export function pickFiles(collectionId: string | null) {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.onchange = () => void uploadFiles([...(input.files ?? [])], collectionId)
  input.click()
}

export function UploadTray() {
  const uploads = useUploads((s) => s.uploads)
  if (uploads.length === 0) return null
  const active = uploads.filter((u) => u.status === 'active').length
  return (
    <section className="upload-tray" aria-label="Uploads">
      <header>
        <h2>{active ? `Uploading ${active}` : 'Uploads finished'}</h2>
        <button type="button" className="icon-btn" aria-label="Close uploads" onClick={() => { uploads.forEach((u) => u.abort.abort()); useUploads.setState({ uploads: [] }) }}><X size={18} /></button>
      </header>
      <ul>
        {uploads.map((u) => (
          <li key={u.id} className="upload-row" data-status={u.status}>
            <span className="upload-text">
              <span className="upload-name">{u.name}</span>
              <span className="upload-detail">{u.error ?? formatBytes(u.size)}</span>
            </span>
            {u.status === 'done' ? <span className="upload-done"><CheckCircle2 size={18} aria-label="Done" /></span> : (
              <button type="button" className="icon-btn" aria-label={`Cancel ${u.name}`} onClick={() => u.abort.abort()}><X size={16} /></button>
            )}
            <span className="upload-bar"><span style={{ transform: `scaleX(${u.progress})` }} /></span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Dropping files anywhere uploads them to wherever you are looking. */
export function DropZone({ collectionId }: { collectionId: string | null }) {
  const [over, setOver] = useState(false)
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depth += 1; setOver(true) } }
    const leave = (e: DragEvent) => { if (hasFiles(e)) { depth -= 1; if (depth <= 0) setOver(false) } }
    const dragover = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault() }
    const drop = (e: DragEvent) => {
      depth = 0
      setOver(false)
      if (!hasFiles(e)) return
      e.preventDefault()
      const files = [...(e.dataTransfer?.files ?? [])]
      if (files.length) void uploadFiles(files, collectionId)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', dragover)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', dragover)
      window.removeEventListener('drop', drop)
    }
  }, [collectionId])
  if (!over) return null
  return <div className="drop-target"><div><UploadCloud size={32} aria-hidden="true" /><p>Drop to upload</p></div></div>
}
