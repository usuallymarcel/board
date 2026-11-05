import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { AUTH_REQUIRED_EVENT } from '../api/client'
import { setPreferenceScope, usePreferences } from '../settings/store'
import { SESSION_KEY, rememberSession, scopeOf, useSession } from './session'

/** Keeps caches and preferences on the right account as the session changes. */
export function SessionWatcher() {
  const qc = useQueryClient()
  const { data: session } = useSession()
  const previous = useRef<string | null>(null)

  useEffect(() => {
    const onAuthRequired = () => { void qc.invalidateQueries({ queryKey: SESSION_KEY }) }
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired)
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired)
  }, [qc])

  const scope = session ? scopeOf(session) : null

  useEffect(() => { if (session) rememberSession(session) }, [session])

  useEffect(() => {
    if (!scope || previous.current === scope) return
    const changed = previous.current !== null
    previous.current = scope
    setPreferenceScope(scope)
    if (changed) qc.removeQueries({ predicate: (q) => q.queryKey[0] !== SESSION_KEY[0] })
    if (scope !== 'anon') void usePreferences.getState().hydrate()
  }, [qc, scope])

  return null
}
