export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = -1
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

export function timeAgo(iso: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [[60, 'second'], [3600, 'minute'], [86400, 'hour'], [604800, 'day'], [2629800, 'week'], [31557600, 'month']]
  let divisor = 1
  for (const [limit, unit] of steps) {
    if (Math.abs(seconds) < limit) return unit === 'second' ? 'just now' : relative.format(Math.round(seconds / divisor), unit)
    divisor = limit
  }
  return relative.format(Math.round(seconds / 31557600), 'year')
}

export const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/** A due date is a plain day: compare as local days, never as a UTC instant. */
export function dueState(day: string): 'overdue' | 'today' | 'soon' | 'later' {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / 86400000)
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  return days <= 3 ? 'soon' : 'later'
}

export function formatDue(day: string): string {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** Stable colour per label text, so the same label looks the same on every card. */
export function labelHue(label: string): number {
  let hash = 0
  for (const char of label) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360
  return hash
}

export const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export const COLORS = ['#e8795f', '#e0b04c', '#4fb99a', '#7c9cff', '#a78bda', '#e66f97', '#8d939e'] as const
