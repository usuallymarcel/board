import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Lock, ShieldCheck, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import { copyText, formatDate, timeAgo } from '../format'
import { failed } from '../items/actions'
import { confirmAction } from '../../ui/dialogs'
import { toast } from '../../ui/primitives'
import { cryptoAvailable, seal } from './crypto'

const EXPIRY = [['1', '1 hour'], ['24', '1 day'], ['168', '7 days'], ['720', '30 days']] as const
const VIEWS = [['1', 'Once'], ['2', '2 views'], ['5', '5 views'], ['10', '10 views']] as const
const MAX_SECRET = 100_000

function GeneratePassword({ onGenerate }: { onGenerate: (text: string) => void }) {
  const make = () => {
    const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_=+'
    // Rejection sampling: a plain modulo would favour the start of the alphabet.
    const limit = 256 - (256 % alphabet.length)
    let out = ''
    while (out.length < 24) {
      const byte = crypto.getRandomValues(new Uint8Array(1))[0] ?? 255
      if (byte < limit) out += alphabet[byte % alphabet.length]
    }
    onGenerate(out)
  }
  return <button type="button" className="text-btn" onClick={make}>Generate a password</button>
}

export function SecretsPage() {
  const qc = useQueryClient()
  const { data = [] } = useQuery({ queryKey: ['secrets'], queryFn: api.secrets })
  const [text, setText] = useState('')
  const [label, setLabel] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [expiry, setExpiry] = useState('24')
  const [views, setViews] = useState('1')
  const [link, setLink] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: async () => {
      const { fragment, ...sealed } = await seal(text, passphrase || undefined)
      const secret = await api.createSecret({ ...sealed, label, max_views: Number(views), expires_in_hours: Number(expiry) })
      return `${window.location.origin}/s/${secret.id}#${fragment}`
    },
    onSuccess: async (url) => {
      setLink(url)
      setText('')
      setLabel('')
      setPassphrase('')
      await qc.invalidateQueries({ queryKey: ['secrets'] })
      toast(await copyText(url) ? 'Link copied' : 'Link ready')
    },
    onError: failed,
  })

  const remove = async (id: string, active: boolean) => {
    if (active && !await confirmAction({ title: 'Revoke this link?', body: 'The secret is destroyed and the link stops working.', action: 'Revoke' })) return
    await api.deleteSecret(id).catch(failed)
    await qc.invalidateQueries({ queryKey: ['secrets'] })
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (text.trim()) create.mutate()
  }

  return (
    <div className="page narrow">
      <header className="page-head"><h1>Secrets</h1></header>
      <p className="lead"><ShieldCheck size={17} aria-hidden="true" /> Share a password as a link that destroys itself. It is encrypted in this browser, and the key is only ever in the link, so this server cannot read it.</p>
      {!cryptoAvailable() ? <p className="form-error" role="alert">Encryption needs a secure connection. Open this site over https.</p> : (
        <form className="panel stack" onSubmit={submit}>
          <label className="input-field">Secret
            <textarea className="secret-input" rows={4} value={text} maxLength={MAX_SECRET} autoComplete="off" spellCheck={false} onChange={(e) => setText(e.target.value)} placeholder="Password, API key, recovery code..." required />
          </label>
          <GeneratePassword onGenerate={setText} />
          <label className="input-field">Label (only you see this)
            <input value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} placeholder="Wifi for Sam" />
          </label>
          <div className="form-row">
            <label className="input-field">Can be viewed
              <select value={views} onChange={(e) => setViews(e.target.value)}>{VIEWS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </label>
            <label className="input-field">Expires after
              <select value={expiry} onChange={(e) => setExpiry(e.target.value)}>{EXPIRY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </label>
          </div>
          <label className="input-field">Passphrase (optional, send it separately)
            <input type="password" autoComplete="new-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={create.isPending}><Lock size={16} aria-hidden="true" /> {create.isPending ? 'Encrypting...' : 'Create secret link'}</button>
        </form>
      )}
      {link && (
        <div className="panel link-result">
          <p className="label">Copy this now. It cannot be shown again, because the key is not stored anywhere.</p>
          <div className="copy-row">
            <input readOnly aria-label="Secret link" value={link} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn" onClick={() => void copyText(link).then((ok) => toast(ok ? 'Link copied' : 'Could not copy'))}><Copy size={16} aria-hidden="true" /> Copy</button>
          </div>
        </div>
      )}
      {data.length > 0 && <h2 className="section-title list-title">Your links</h2>}
      <ul className="rows">
        {data.map((secret) => (
          <li key={secret.id}>
            <span className="rows-title">{secret.label || 'Untitled secret'}</span>
            <span className="status-chip" data-on={secret.active}>{secret.active ? `${secret.max_views - secret.views} view${secret.max_views - secret.views === 1 ? '' : 's'} left` : secret.views >= secret.max_views ? 'Viewed' : 'Expired'}</span>
            <span className="hint rows-time" title={formatDate(secret.created_at)}>{timeAgo(secret.created_at)}</span>
            <button type="button" className="icon-btn" aria-label={secret.active ? `Revoke ${secret.label || 'secret'}` : `Remove ${secret.label || 'secret'}`} onClick={() => void remove(secret.id, secret.active)}><Trash2 size={17} /></button>
          </li>
        ))}
      </ul>
    </div>
  )
}
