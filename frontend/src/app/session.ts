import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Session } from '../api/types'
import { toast } from '../ui/primitives'

const STORAGE_KEY = 'board.session'
export const SESSION_KEY = ['session'] as const

export function cachedSession(): Session | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) as Session : undefined
  } catch {
    return undefined
  }
}

export const rememberSession = (session: Session) => localStorage.setItem(STORAGE_KEY, JSON.stringify(session))

export const scopeOf = (session: Pick<Session, 'mode' | 'user'>) =>
  session.user ? `u${session.user.id}` : session.mode === 'global' ? 'global' : 'anon'

/** True when this session may touch private data. */
export const canUsePrivate = (session: Session) => Boolean(session.user) || session.mode === 'global'

export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: api.session,
    initialData: cachedSession,
    initialDataUpdatedAt: 0, // always verify a cached session
    refetchOnWindowFocus: 'always',
    refetchInterval: 60_000,
    retry: false,
  })
}

/** Session once known; only for components rendered behind the session gate. */
export function useReadySession(): Session {
  const { data } = useSession()
  if (!data) throw new Error('useReadySession used outside the session gate')
  return data
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.logout,
    onSuccess: (session) => {
      qc.clear() // Nothing of this account stays in memory for the next person.
      qc.setQueryData(SESSION_KEY, session)
    },
    onError: () => toast('Could not sign out. Check your connection.'),
  })
}
