import DOMPurify from 'dompurify'
import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: true })

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    const href = node.getAttribute('href') ?? ''
    if (/^https?:/i.test(href)) {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer nofollow')
    }
  }
  if (node.tagName === 'IMG') node.setAttribute('loading', 'lazy')
})

/** Markdown comes from other people on the forum, so what reaches the DOM is always sanitised. */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false })
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'option', 'iframe', 'video', 'audio', 'svg', 'math'],
    FORBID_ATTR: ['style', 'id', 'class', 'srcset'],
  })
}
