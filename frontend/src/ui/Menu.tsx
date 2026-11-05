import { MoreHorizontal, type LucideIcon } from 'lucide-react'
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'

export interface MenuEntry {
  label: string
  Icon?: LucideIcon
  run: () => void
  danger?: boolean
  disabled?: boolean
  /** Rendered instead of the label row, for things like colour swatches. */
  custom?: ReactNode
}
export type MenuEntries = (MenuEntry | null | false)[]

interface MenuState { open: { entries: MenuEntry[]; x: number; y: number } | null; close: () => void }
const useMenu = create<MenuState>((set) => ({ open: null, close: () => set({ open: null }) }))

export function openMenu(entries: MenuEntries, x: number, y: number) {
  useMenu.setState({ open: { entries: entries.filter(Boolean) as MenuEntry[], x, y } })
}

/** Right-click anywhere on a row opens the same menu as its button. */
export const contextMenu = (entries: () => MenuEntries) => (e: MouseEvent) => {
  e.preventDefault()
  e.stopPropagation()
  openMenu(entries(), e.clientX, e.clientY)
}

export function MenuButton({ label, entries, children }: { label: string; entries: () => MenuEntries; children?: ReactNode }) {
  return (
    <button
      type="button"
      className={children ? 'btn' : 'icon-btn'}
      aria-label={label}
      aria-haspopup="menu"
      title={label}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const box = e.currentTarget.getBoundingClientRect()
        openMenu(entries(), box.right, box.bottom + 4)
      }}
    >
      {children ?? <MoreHorizontal size={19} />}
    </button>
  )
}

export function MenuHost() {
  const { open, close } = useMenu()
  const panel = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })

  useLayoutEffect(() => {
    if (!open || !panel.current) return
    opener.current = document.activeElement as HTMLElement | null
    const box = panel.current.getBoundingClientRect()
    const left = open.x + box.width > window.innerWidth - 8 ? Math.max(8, open.x - box.width) : open.x
    const top = open.y + box.height > window.innerHeight - 8 ? Math.max(8, window.innerHeight - box.height - 8) : open.y
    setPosition({ left, top })
    panel.current.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); opener.current?.focus(); return }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const rows = [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])]
      const at = rows.indexOf(document.activeElement as HTMLElement)
      rows[(at + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, close])

  if (!open) return null
  return createPortal(
    <>
      <div className="menu-backdrop" onClick={close} onContextMenu={(e) => { e.preventDefault(); close() }} />
      <div ref={panel} className="menu" role="menu" style={position}>
        {open.entries.map((entry) => (entry.custom ? <Fragment key={entry.label}>{entry.custom}</Fragment> : (
          <button
            key={entry.label}
            type="button"
            role="menuitem"
            data-danger={entry.danger}
            disabled={entry.disabled}
            onClick={() => { close(); entry.run() }}
          >
            {entry.Icon && <entry.Icon size={16} aria-hidden="true" />} {entry.label}
          </button>
        )))}
      </div>
    </>,
    document.body,
  )
}
