const FENCE = /^\s*(```|~~~)/
const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+\[)( |x|X)(\])/

function eachTask(source: string, visit: (line: string, index: number, count: number, match: RegExpExecArray) => void) {
  const lines = source.split('\n')
  let fenced = false
  let count = 0
  lines.forEach((line, index) => {
    if (FENCE.test(line)) { fenced = !fenced; return }
    if (fenced) return
    const match = TASK.exec(line)
    if (match) { visit(line, index, count, match); count += 1 }
  })
  return lines
}

/** Flips the nth `- [ ]` in the source, for clicks on rendered checkboxes. */
export function toggleTask(source: string, target: number): string {
  let change: { index: number; line: string } | null = null
  const lines = eachTask(source, (line, index, count, match) => {
    if (count !== target) return
    const mark = match[2] === ' ' ? 'x' : ' '
    change = { index, line: `${match[1]}${mark}${match[3]}${line.slice(match[0].length)}` }
  })
  const found = change as { index: number; line: string } | null
  if (found) lines[found.index] = found.line
  return lines.join('\n')
}

export function taskProgress(source: string): { done: number; total: number } {
  let done = 0
  let total = 0
  eachTask(source, (_line, _index, _count, match) => {
    total += 1
    if (match[2] !== ' ') done += 1
  })
  return { done, total }
}
