import {
  Bold, CheckSquare, Code, Heading2, ImagePlus, Italic, Link2, List, ListOrdered, Minus, Quote, Table,
} from 'lucide-react'
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { ApiError, mediaUrl, uploadFile } from '../../api/client'
import { useIsWide } from '../../app/useIsWide'
import type { EditorMode } from '../../settings/schema'
import { usePreferences } from '../../settings/store'
import { Segmented, toast } from '../../ui/primitives'
import { Markdown } from './Markdown'
import { continueList, insert, prefixLines, wrap, type Edit } from './edit'

const MODES: readonly { value: EditorMode; label: string }[] = [
  { value: 'write', label: 'Write' }, { value: 'split', label: 'Split' }, { value: 'preview', label: 'Preview' },
]
const TABLE = '\n| Column | Column |\n| --- | --- |\n| Text | Text |\n'

function pastedName(file: File, index: number) {
  if (file.name && file.name !== 'image.png') return file.name
  const extension = file.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'
  return `pasted-${Date.now()}-${index}.${extension}`
}

export function MarkdownEditor({ value, onChange, placeholder, label, compact = false, autoFocus = false, extra }: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  label: string
  /** Comments and cards: less height, write and preview only. */
  compact?: boolean
  autoFocus?: boolean
  extra?: ReactNode
}) {
  const preferred = usePreferences((s) => s.prefs.editorMode)
  const font = usePreferences((s) => s.prefs.editorFont)
  const wide = useIsWide()
  const [chosen, setChosen] = useState<EditorMode | null>(null)
  const canSplit = wide && !compact
  const wanted = chosen ?? (compact ? 'write' : preferred)
  const mode: EditorMode = wanted === 'split' && !canSplit ? 'write' : wanted
  const area = useRef<HTMLTextAreaElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const preview = useRef<HTMLDivElement>(null)
  // Uploads finish later, when the text may have moved on: always edit the newest text.
  const latest = useRef(value)
  latest.current = value
  const pendingCaret = useRef<[number, number] | null>(null)

  useEffect(() => {
    if (pendingCaret.current && area.current) {
      area.current.setSelectionRange(...pendingCaret.current)
      pendingCaret.current = null
    }
  })

  const apply = (edit: Edit) => {
    pendingCaret.current = [edit.start, edit.end]
    latest.current = edit.value
    onChange(edit.value)
    area.current?.focus()
  }

  const onSelection = (make: (v: string, s: number, e: number) => Edit) => {
    const el = area.current
    if (el) apply(make(el.value, el.selectionStart, el.selectionEnd))
  }

  const upload = async (files: File[]) => {
    await Promise.all(files.map(async (original, index) => {
      const name = pastedName(original, index)
      const named = new File([original], name, { type: original.type })
      const image = original.type.startsWith('image/')
      const marker = `${image ? '!' : ''}[Uploading ${name}...]()`
      const el = area.current
      const start = el?.selectionStart ?? latest.current.length
      const end = el?.selectionEnd ?? start
      apply(insert(latest.current, start, end, `${marker}\n`))
      try {
        const item = await uploadFile(named, { inline: true }, () => undefined)
        const link = `${image ? '!' : ''}[${name.replace(/[[\]]/g, '')}](${mediaUrl(item.id, name)})`
        const next = latest.current.replace(marker, link)
        latest.current = next
        onChange(next)
      } catch (err) {
        const next = latest.current.replace(`${marker}\n`, '')
        latest.current = next
        onChange(next)
        toast(err instanceof ApiError ? err.message : `Could not upload ${name}`)
      }
    }))
  }

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files]
    if (files.length === 0) return
    e.preventDefault()
    void upload(files)
  }

  const onDrop = (e: DragEvent<HTMLTextAreaElement>) => {
    const files = [...e.dataTransfer.files]
    if (files.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    void upload(files)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key === 'b') { e.preventDefault(); onSelection((v, s, n) => wrap(v, s, n, '**')) }
    else if (mod && e.key === 'i') { e.preventDefault(); onSelection((v, s, n) => wrap(v, s, n, '*')) }
    else if (mod && e.key === 'k') { e.preventDefault(); e.stopPropagation(); onSelection((v, s, n) => wrap(v, s, n, '[', '](https://)', 'link')) }
    else if (e.key === 'Tab') { e.preventDefault(); onSelection((v, s, n) => (e.shiftKey ? prefixLines(v, s, n, '  ') : s === n ? insert(v, s, n, '  ') : prefixLines(v, s, n, '  '))) }
    else if (e.key === 'Enter' && !e.shiftKey && !mod) {
      const el = e.currentTarget
      if (el.selectionStart !== el.selectionEnd) return
      const edit = continueList(el.value, el.selectionStart)
      if (edit) { e.preventDefault(); apply(edit) }
    }
  }

  // Keep the preview roughly level with the text being edited.
  const onScroll = () => {
    const el = area.current
    const other = preview.current
    if (!el || !other || mode !== 'split') return
    const ratio = el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)
    other.scrollTop = ratio * (other.scrollHeight - other.clientHeight)
  }

  const tools: [ReactNode, string, () => void][] = [
    [<Heading2 size={17} />, 'Heading', () => onSelection((v, s, n) => prefixLines(v, s, n, '## '))],
    [<Bold size={17} />, 'Bold (Ctrl+B)', () => onSelection((v, s, n) => wrap(v, s, n, '**'))],
    [<Italic size={17} />, 'Italic (Ctrl+I)', () => onSelection((v, s, n) => wrap(v, s, n, '*'))],
    [<Code size={17} />, 'Code', () => onSelection((v, s, n) => (v.slice(s, n).includes('\n') ? wrap(v, s, n, '```\n', '\n```') : wrap(v, s, n, '`', '`', 'code')))],
    [<Link2 size={17} />, 'Link (Ctrl+K)', () => onSelection((v, s, n) => wrap(v, s, n, '[', '](https://)', 'link'))],
    [<List size={17} />, 'Bullet list', () => onSelection((v, s, n) => prefixLines(v, s, n, '- '))],
    [<ListOrdered size={17} />, 'Numbered list', () => onSelection((v, s, n) => prefixLines(v, s, n, '1. '))],
    [<CheckSquare size={17} />, 'Checklist', () => onSelection((v, s, n) => prefixLines(v, s, n, '- [ ] '))],
    [<Quote size={17} />, 'Quote', () => onSelection((v, s, n) => prefixLines(v, s, n, '> '))],
    [<Table size={17} />, 'Table', () => onSelection((v, s, n) => insert(v, s, n, TABLE))],
    [<Minus size={17} />, 'Divider', () => onSelection((v, s, n) => insert(v, s, n, '\n---\n'))],
    [<ImagePlus size={17} />, 'Insert image or file', () => file.current?.click()],
  ]

  return (
    <div className="editor" data-mode={mode} data-compact={compact}>
      <div className="editor-bar">
        {mode !== 'preview' && (
          <div className="editor-tools" role="toolbar" aria-label={`${label} formatting`}>
            {tools.map(([icon, title, run]) => (
              <button key={title} type="button" className="tool" title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()} onClick={run}>{icon}</button>
            ))}
          </div>
        )}
        <span className="editor-spacer" />
        {extra}
        <Segmented
          label="Editor view"
          value={mode}
          options={canSplit ? MODES : MODES.filter((m) => m.value !== 'split')}
          onChange={setChosen}
        />
      </div>
      <input ref={file} type="file" multiple hidden onChange={(e) => { void upload([...(e.target.files ?? [])]); e.target.value = '' }} />
      <div className="editor-panes">
        {mode !== 'preview' && (
          <textarea
            ref={area}
            className="editor-input"
            data-font={font}
            aria-label={label}
            value={value}
            placeholder={placeholder}
            autoFocus={autoFocus}
            spellCheck
            onChange={(e) => onChange(e.target.value)}
            onPaste={onPaste}
            onDrop={onDrop}
            onKeyDown={onKeyDown}
            onScroll={onScroll}
          />
        )}
        {mode !== 'write' && (
          <div ref={preview} className="editor-preview">
            <Markdown source={value} onChange={onChange} empty="Nothing to preview yet." />
          </div>
        )}
      </div>
    </div>
  )
}
