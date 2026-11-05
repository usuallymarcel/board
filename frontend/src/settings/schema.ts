export type Theme =
  | 'system' | 'custom' | 'dark' | 'oled' | 'slate' | 'midnight' | 'forest' | 'plum' | 'ember'
  | 'light' | 'paper' | 'sepia' | 'sage' | 'sky' | 'blush'
export type Corners = 'sharp' | 'soft' | 'round'
export type Density = 'compact' | 'comfortable'
export type ItemView = 'grid' | 'list'
export type ItemSort = 'updated' | 'created' | 'title'
export type EditorMode = 'write' | 'split' | 'preview'
export type EditorFont = 'sans' | 'mono'

export interface CustomColors { bg: string; fg: string }

export interface Preferences {
  version: 1
  theme: Theme
  accent: string // #rrggbb
  /** used when theme is 'custom' */
  customTheme: CustomColors
  corners: Corners
  density: Density
  textSize: number // px, 13..18
  itemView: ItemView
  itemSort: ItemSort
  editorMode: EditorMode
  editorFont: EditorFont
  homePinned: boolean
  homeDue: boolean
  homeRecent: boolean
}

export const DEFAULT_PREFERENCES: Preferences = {
  version: 1,
  theme: 'dark',
  accent: '#7c9cff',
  customTheme: { bg: '#14181f', fg: '#e8ecf2' },
  corners: 'soft',
  density: 'comfortable',
  textSize: 15,
  itemView: 'grid',
  itemSort: 'updated',
  editorMode: 'split',
  editorFont: 'sans',
  homePinned: true,
  homeDue: true,
  homeRecent: true,
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Deep-merge `patch` over `base`. Unknown keys are kept so newer clients don't lose data. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : patch) as T
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) out[key] = deepMerge(out[key], value)
  return out as T
}
