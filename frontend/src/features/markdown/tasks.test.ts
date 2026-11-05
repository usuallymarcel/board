import { describe, expect, it } from 'vitest'
import { taskProgress, toggleTask } from './tasks'

describe('toggleTask', () => {
  it('flips only the chosen task', () => {
    expect(toggleTask('- [ ] a\n- [ ] b', 1)).toBe('- [ ] a\n- [x] b')
    expect(toggleTask('- [x] a', 0)).toBe('- [ ] a')
  })

  it('handles nesting and ordered lists', () => {
    expect(toggleTask('1. [ ] a\n   - [ ] b', 1)).toBe('1. [ ] a\n   - [x] b')
  })

  it('ignores tasks inside code fences, as the renderer does', () => {
    const source = '```\n- [ ] code\n```\n- [ ] real'
    expect(toggleTask(source, 0)).toBe('```\n- [ ] code\n```\n- [x] real')
  })

  it('leaves the text alone when the index is out of range', () => {
    expect(toggleTask('- [ ] a', 4)).toBe('- [ ] a')
  })
})

describe('taskProgress', () => {
  it('counts', () => {
    expect(taskProgress('- [x] a\n- [ ] b\n* [X] c\nplain')).toEqual({ done: 2, total: 3 })
    expect(taskProgress('none')).toEqual({ done: 0, total: 0 })
  })
})
