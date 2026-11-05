import { useMemo, type MouseEvent } from 'react'
import { renderMarkdown } from './render'
import { toggleTask } from './tasks'

/** Rendered markdown. With onChange, task checkboxes can be ticked right here. */
export function Markdown({ source, onChange, empty }: { source: string; onChange?: (next: string) => void; empty?: string }) {
  const html = useMemo(() => {
    const rendered = renderMarkdown(source)
    return onChange ? rendered.replace(/<input disabled="" type="checkbox"/g, '<input type="checkbox"').replace(/<input disabled="" checked="" type="checkbox"/g, '<input checked="" type="checkbox"') : rendered
  }, [source, onChange])

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (!onChange || !(target instanceof HTMLInputElement) || target.type !== 'checkbox') return
    e.preventDefault()
    const boxes = [...e.currentTarget.querySelectorAll('input[type="checkbox"]')]
    onChange(toggleTask(source, boxes.indexOf(target)))
  }

  if (!source.trim()) return <p className="muted">{empty ?? ''}</p>
  return <div className="md" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
}
