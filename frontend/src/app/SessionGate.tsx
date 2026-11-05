import { CloudOff } from 'lucide-react'
import { Outlet } from 'react-router-dom'
import { LoginPage } from '../auth/LoginPage'
import { canUsePrivate, useSession } from './session'

export function Splash() {
  return <div className="splash" aria-hidden="true"><img src="/icon.svg" alt="" width="56" height="56" /></div>
}

export function Unreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="unreachable" role="alert">
      <CloudOff size={28} aria-hidden="true" />
      <h1>Can&rsquo;t reach Board</h1>
      <p>Check your connection and try again.</p>
      <button type="button" className="btn" onClick={onRetry}>Try again</button>
    </div>
  )
}

/** Renders once the session is known. Public pages sit here. */
export function SessionReady() {
  const { data, isError, refetch } = useSession()
  if (!data) return isError ? <Unreachable onRetry={() => void refetch()} /> : <Splash />
  return <Outlet />
}

/** Private pages sit here. */
export function RequireUser() {
  const { data } = useSession()
  if (!data) return null
  return canUsePrivate(data) ? <Outlet /> : <LoginPage session={data} />
}
