import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'

interface Ask { kind: 'ask'; title: string; label: string; value: string; action: string; resolve: (v: string | null) => void }
interface Confirm { kind: 'confirm'; title: string; body: string; action: string; danger: boolean; resolve: (v: boolean) => void }

const useDialog = create<{ dialog: Ask | Confirm | null }>(() => ({ dialog: null }))
const close = () => useDialog.setState({ dialog: null })

/** Promise versions of prompt() and confirm() that match the rest of the app. */
export const askText = (options: { title: string; label: string; value?: string; action?: string }) =>
  new Promise<string | null>((resolve) => {
    useDialog.setState({ dialog: { kind: 'ask', value: '', action: 'Save', ...options, resolve } })
  })

export const confirmAction = (options: { title: string; body: string; action: string; danger?: boolean }) =>
  new Promise<boolean>((resolve) => {
    useDialog.setState({ dialog: { kind: 'confirm', danger: true, ...options, resolve } })
  })

function AskForm({ dialog }: { dialog: Ask }) {
  const [value, setValue] = useState(dialog.value)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.select() }, [])
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!value.trim()) return
    dialog.resolve(value.trim())
    close()
  }
  return (
    <form onSubmit={submit}>
      <h2>{dialog.title}</h2>
      <label className="input-field">{dialog.label}
        <input ref={input} value={value} onChange={(e) => setValue(e.target.value)} autoFocus maxLength={300} />
      </label>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={() => { dialog.resolve(null); close() }}>Cancel</button>
        <button type="submit" className="btn btn-primary">{dialog.action}</button>
      </div>
    </form>
  )
}

export function DialogHost() {
  const dialog = useDialog((s) => s.dialog)
  useEffect(() => {
    if (!dialog) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (dialog.kind === 'ask') dialog.resolve(null)
      else dialog.resolve(false)
      close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [dialog])
  if (!dialog) return null
  return createPortal(
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-label={dialog.title}>
        {dialog.kind === 'ask' ? <AskForm dialog={dialog} /> : (
          <>
            <h2>{dialog.title}</h2>
            <p>{dialog.body}</p>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => { dialog.resolve(false); close() }}>Cancel</button>
              <button type="button" autoFocus className={`btn ${dialog.danger ? 'btn-solid-danger' : 'btn-primary'}`} onClick={() => { dialog.resolve(true); close() }}>{dialog.action}</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
