import { useQuery } from '@tanstack/react-query'
import { Check, LogOut } from 'lucide-react'
import type { ReactNode } from 'react'
import { api } from '../api/client'
import type { AuthStatus } from '../api/types'
import { formatBytes } from '../features/format'
import type { Corners, Density, EditorFont, EditorMode, ItemSort, ItemView, Preferences, Theme } from '../settings/schema'
import { usePreferences } from '../settings/store'
import { ColorField, Segmented, Slider, Switch, toast } from '../ui/primitives'
import { canUsePrivate, useLogout, useReadySession } from './session'
import { THEMES, usableColors } from './theme'

declare const __APP_VERSION__: string

const CORNERS: readonly { value: Corners; label: string }[] = [{ value: 'sharp', label: 'Sharp' }, { value: 'soft', label: 'Soft' }, { value: 'round', label: 'Round' }]
const DENSITY: readonly { value: Density; label: string }[] = [{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]
const VIEWS: readonly { value: ItemView; label: string }[] = [{ value: 'grid', label: 'Grid' }, { value: 'list', label: 'List' }]
const SORTS: readonly { value: ItemSort; label: string }[] = [{ value: 'updated', label: 'Recent' }, { value: 'created', label: 'Created' }, { value: 'title', label: 'Name' }]
const EDITOR: readonly { value: EditorMode; label: string }[] = [{ value: 'write', label: 'Write' }, { value: 'split', label: 'Split' }, { value: 'preview', label: 'Preview' }]
const FONTS: readonly { value: EditorFont; label: string }[] = [{ value: 'sans', label: 'Sans' }, { value: 'mono', label: 'Monospace' }]

const ACCENTS = [
  ['#7c9cff', 'Periwinkle'], ['#e8795f', 'Terracotta'], ['#e0b04c', 'Amber'], ['#4fb99a', 'Jade'],
  ['#e66f97', 'Rose'], ['#a78bda', 'Iris'], ['#c9ccd3', 'Silver'],
] as const

const SERVER_STATUS: Record<AuthStatus, string> = {
  disabled: 'Single workspace. Accounts aren’t set up on this server.',
  unavailable: 'The account service is unreachable right now.',
  ok: 'Connected to the account service.',
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="settings-section"><h2>{title}</h2><div className="settings-card">{children}</div></section>
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field-row">
      <span className="label">{label}{hint && <span className="hint">{hint}</span>}</span>
      {children}
    </div>
  )
}

function Stacked({ label, children }: { label: string; children: ReactNode }) {
  return <div className="field-col"><span className="label">{label}</span>{children}</div>
}

function Appearance({ prefs, update }: { prefs: Preferences; update: (p: unknown) => void }) {
  const custom = !ACCENTS.some(([value]) => value === prefs.accent.toLowerCase())
  const customTheme = prefs.theme === 'custom'
  const usable = usableColors(prefs.customTheme.bg, prefs.customTheme.fg)
  const tile = (value: Theme, label: string, background: string, color: string) => (
    <button key={value} type="button" role="radio" aria-checked={prefs.theme === value} aria-label={label} className="theme-tile" onClick={() => update({ theme: value })}>
      <span style={{ background, color }}>Aa</span>
      {label}
    </button>
  )
  return (
    <Section title="Appearance">
      <Stacked label="Theme">
        <div className="theme-grid" role="radiogroup" aria-label="Theme">
          {tile('system', 'System', 'linear-gradient(135deg, #f6f6f7 50%, #0b0c0e 50%)', 'transparent')}
          {THEMES.map((t) => tile(t.value, t.label, t.bg, t.fg))}
          {tile('custom', 'Custom', usable.bg, usable.fg)}
        </div>
        {customTheme && (
          <div className="color-fields">
            <ColorField label="Background" value={usable.bg} onChange={(bg) => update({ customTheme: { bg } })} />
            <ColorField label="Text" value={prefs.customTheme.fg} onChange={(fg) => update({ customTheme: { fg } })} />
          </div>
        )}
        {customTheme && usable.adjusted && <p className="hint" role="status">That text color would be unreadable, so the app is using a clearer one.</p>}
      </Stacked>
      <Stacked label="Accent">
        <div className="swatches" role="radiogroup" aria-label="Accent colour">
          {ACCENTS.map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={prefs.accent.toLowerCase() === value} aria-label={label} style={{ background: value }} onClick={() => update({ accent: value })}>
              {prefs.accent.toLowerCase() === value && <Check size={16} strokeWidth={3} color="var(--on-accent)" />}
            </button>
          ))}
          <label className="swatch-custom" data-on={custom} style={custom ? { background: prefs.accent } : undefined}>
            <span className="sr-only">Custom accent colour</span>
            <input type="color" value={prefs.accent} onChange={(e) => update({ accent: e.target.value })} />
          </label>
        </div>
      </Stacked>
      <Stacked label="Corners"><Segmented label="Corners" value={prefs.corners} options={CORNERS} onChange={(corners) => update({ corners })} /></Stacked>
      <Stacked label="Density"><Segmented label="Density" value={prefs.density} options={DENSITY} onChange={(density) => update({ density })} /></Stacked>
      <Slider label="Text size" value={prefs.textSize} min={13} max={18} step={1} format={(v) => `${v}px`} onChange={(textSize) => update({ textSize })} />
    </Section>
  )
}

function Workspace({ prefs, update }: { prefs: Preferences; update: (p: unknown) => void }) {
  return (
    <>
      <Section title="Items">
        <Stacked label="View"><Segmented label="View" value={prefs.itemView} options={VIEWS} onChange={(itemView) => update({ itemView })} /></Stacked>
        <Stacked label="Sort by"><Segmented label="Sort by" value={prefs.itemSort} options={SORTS} onChange={(itemSort) => update({ itemSort })} /></Stacked>
      </Section>
      <Section title="Editor">
        <Stacked label="Open notes in"><Segmented label="Open notes in" value={prefs.editorMode} options={EDITOR} onChange={(editorMode) => update({ editorMode })} /></Stacked>
        <Stacked label="Writing font"><Segmented label="Writing font" value={prefs.editorFont} options={FONTS} onChange={(editorFont) => update({ editorFont })} /></Stacked>
      </Section>
      <Section title="Home page">
        <Row label="Pinned"><Switch label="Show pinned" checked={prefs.homePinned} onChange={(homePinned) => update({ homePinned })} /></Row>
        <Row label="Due cards"><Switch label="Show due cards" checked={prefs.homeDue} onChange={(homeDue) => update({ homeDue })} /></Row>
        <Row label="Recent"><Switch label="Show recent" checked={prefs.homeRecent} onChange={(homeRecent) => update({ homeRecent })} /></Row>
      </Section>
    </>
  )
}

function Storage() {
  const { data } = useQuery({ queryKey: ['usage'], queryFn: api.usage })
  if (!data) return null
  const percent = Math.min(100, (data.used / Math.max(1, data.quota)) * 100)
  return (
    <Section title="Storage">
      <Row label={`${formatBytes(data.used)} of ${formatBytes(data.quota)}`} hint={`${data.notes} notes, ${data.boards} boards, ${data.files} files, ${data.trash} in trash`}>
        <span className="muted">{percent.toFixed(0)}%</span>
      </Row>
      <span className="meter" role="img" aria-label={`${percent.toFixed(0)} percent of storage used`}><span style={{ width: `${percent}%` }} /></span>
    </Section>
  )
}

function Account() {
  const session = useReadySession()
  const logout = useLogout()
  if (!session.user) return null
  return (
    <Section title="Account">
      <Row label={session.user.name} hint={session.is_admin ? 'Forum moderator' : undefined}>
        <button type="button" className="btn" onClick={() => logout.mutate()} disabled={logout.isPending}><LogOut size={16} aria-hidden="true" /> Sign out</button>
      </Row>
    </Section>
  )
}

export function SettingsPage() {
  const prefs = usePreferences((s) => s.prefs)
  const update = usePreferences((s) => s.update)
  const reset = usePreferences((s) => s.reset)
  const session = useReadySession()
  const signedIn = canUsePrivate(session)
  return (
    <div className="page settings">
      <header className="page-head"><h1>Settings</h1></header>
      <Account />
      <Appearance prefs={prefs} update={update} />
      {signedIn && <Workspace prefs={prefs} update={update} />}
      {signedIn && <Storage />}
      <Section title="About">
        <Row label="Server"><span className="status-text">{SERVER_STATUS[session.auth_status]}</span></Row>
        <Row label="Upload limit"><span className="muted">{session.max_upload_mb.toLocaleString()} MB per file</span></Row>
        <Row label="Version"><span className="muted">Board {__APP_VERSION__}</span></Row>
        <button type="button" className="btn btn-danger" onClick={() => { reset(); toast('Settings reset to defaults') }}>Reset settings to default</button>
      </Section>
    </div>
  )
}
