export interface Edit { value: string; start: number; end: number }

/** Wraps the selection, or unwraps it when it is already wrapped. */
export function wrap(value: string, start: number, end: number, before: string, after = before, fallback = 'text'): Edit {
  const selected = value.slice(start, end)
  if (value.slice(start - before.length, start) === before && value.slice(end, end + after.length) === after) {
    return { value: value.slice(0, start - before.length) + selected + value.slice(end + after.length), start: start - before.length, end: end - before.length }
  }
  const body = selected || fallback
  return { value: value.slice(0, start) + before + body + after + value.slice(end), start: start + before.length, end: start + before.length + body.length }
}

/** Adds or removes a prefix on every selected line. */
export function prefixLines(value: string, start: number, end: number, prefix: string): Edit {
  const from = value.lastIndexOf('\n', start - 1) + 1
  const lines = value.slice(from, end).split('\n')
  const all = lines.every((line) => line.startsWith(prefix))
  const changed = lines.map((line) => (all ? line.slice(prefix.length) : prefix + line)).join('\n')
  return { value: value.slice(0, from) + changed + value.slice(end), start: from, end: from + changed.length }
}

export function insert(value: string, start: number, end: number, text: string): Edit {
  const at = start + text.length
  return { value: value.slice(0, start) + text + value.slice(end), start: at, end: at }
}

/** Enter inside a list continues it; Enter on an empty item ends it. */
export function continueList(value: string, caret: number): Edit | null {
  const from = value.lastIndexOf('\n', caret - 1) + 1
  const line = value.slice(from, caret)
  const match = /^(\s*)([-*+]|(\d+)\.)(\s+\[[ xX]\])?\s+/.exec(line)
  if (!match) return null
  if (line === match[0]) return { value: value.slice(0, from) + value.slice(caret), start: from, end: from }
  const marker = match[3] ? `${Number(match[3]) + 1}.` : match[2]
  return insert(value, caret, caret, `\n${match[1]}${marker}${match[4] ? ' [ ]' : ''} `)
}
