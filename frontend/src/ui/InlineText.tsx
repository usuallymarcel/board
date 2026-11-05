import { useEffect, useState, type KeyboardEvent } from 'react'

/** Looks like text, edits in place. Enter or leaving saves, Escape puts it back. */
export function InlineText({ value, onSave, label, placeholder, className }: {
  value: string
  onSave: (next: string) => void
  label: string
  placeholder?: string
  className?: string
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    const next = draft.trim()
    if (next && next !== value) onSave(next)
    else setDraft(value)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur()
    if (e.key === 'Escape') { e.stopPropagation(); setDraft(value); requestAnimationFrame(() => e.currentTarget?.blur()) }
  }
  return (
    <input
      className={`inline-text ${className ?? ''}`}
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
    />
  )
}
