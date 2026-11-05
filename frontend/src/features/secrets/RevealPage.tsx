import { useQuery } from '@tanstack/react-query'
import { Copy, Eye, EyeOff, KeyRound, ShieldAlert } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { ApiError, api } from '../../api/client'
import { copyText, formatDate } from '../format'
import { toast } from '../../ui/primitives'
import { cryptoAvailable, open, passphraseVerifier } from './crypto'

/** Public. Nothing is spent until the visitor presses the button, so link previews are harmless. */
export function RevealPage() {
  const { id = '' } = useParams()
  const [fragment] = useState(() => window.location.hash.slice(1))
  const { data: info, isError, isLoading } = useQuery({ queryKey: ['public-secret', id], queryFn: () => api.secretInfo(id), retry: false, refetchOnWindowFocus: false })
  const [passphrase, setPassphrase] = useState('')
  const [secret, setSecret] = useState<string | null>(null)
  const [left, setLeft] = useState(0)
  const [hidden, setHidden] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reveal = async (e: FormEvent) => {
    e.preventDefault()
    if (!info) return
    setBusy(true)
    setError(null)
    try {
      const verifier = info.has_passphrase && info.salt ? await passphraseVerifier(passphrase, info.salt) : undefined
      const payload = await api.revealSecret(id, verifier)
      setSecret(await open(payload, fragment, info.has_passphrase ? passphrase : undefined, info.salt))
      setLeft(payload.views_left)
      // The key has done its job: keep it out of browser history and screenshots from here on.
      history.replaceState(null, '', window.location.pathname)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'This link is incomplete, so the secret could not be decrypted.')
    }
    setBusy(false)
  }

  const shell = (children: React.ReactNode) => (
    <main className="public-page"><div className="public-card"><img src="/icon.svg" alt="" width="40" height="40" className="login-mark" />{children}</div></main>
  )

  if (isLoading) return shell(<p className="muted">Checking the link...</p>)
  if (secret !== null) {
    return shell(
      <>
        <h1>Your secret</h1>
        <pre className="secret-output">{hidden ? '••••••••••••' : secret}</pre>
        <div className="button-row">
          <button type="button" className="btn btn-primary" onClick={() => void copyText(secret).then((ok) => toast(ok ? 'Copied' : 'Could not copy'))}><Copy size={16} aria-hidden="true" /> Copy</button>
          <button type="button" className="btn" onClick={() => setHidden(!hidden)}>{hidden ? <Eye size={16} aria-hidden="true" /> : <EyeOff size={16} aria-hidden="true" />} {hidden ? 'Show' : 'Hide'}</button>
        </div>
        <p className="hint">{left > 0 ? `This link can be opened ${left} more time${left === 1 ? '' : 's'}.` : 'This link no longer works. Leaving this page loses the secret, so save it now.'}</p>
      </>,
    )
  }
  if (isError || !info) {
    return shell(
      <>
        <ShieldAlert size={28} aria-hidden="true" />
        <h1>Nothing here</h1>
        <p className="muted">This secret has been viewed, has expired, or never existed.</p>
      </>,
    )
  }
  if (!fragment) return shell(<><h1>Incomplete link</h1><p className="muted">The part of the link after the # is missing. Ask for the whole link again.</p></>)
  if (!cryptoAvailable()) return shell(<><h1>Secure connection needed</h1><p className="muted">Open this link over https.</p></>)
  return shell(
    <form className="stack" onSubmit={(e) => void reveal(e)}>
      <h1>Someone shared a secret with you</h1>
      <p className="muted">
        {info.views_left === 1 ? 'You can view it once. It is destroyed afterwards.' : `It can be viewed ${info.views_left} more times.`} Available until {formatDate(info.expires_at)}.
      </p>
      {info.has_passphrase && (
        <label className="input-field">Passphrase
          <input type="password" autoFocus required value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="off" />
        </label>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy}><KeyRound size={16} aria-hidden="true" /> {busy ? 'Decrypting...' : 'Reveal secret'}</button>
    </form>,
  )
}
