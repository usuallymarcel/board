import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Navigate, Outlet, RouterProvider, ScrollRestoration, createBrowserRouter, useSearchParams } from 'react-router-dom'
import { LoginPage } from '../auth/LoginPage'
import { BoardPage } from '../features/boards/BoardPage'
import { ForumPage } from '../features/forum/ForumPage'
import { PostEditor } from '../features/forum/PostEditor'
import { PostPage } from '../features/forum/PostPage'
import { HomePage } from '../features/items/HomePage'
import { ItemsPage } from '../features/items/ItemsPage'
import { TrashPage } from '../features/items/TrashPage'
import { UploadTray } from '../features/items/upload'
import { NotePage } from '../features/notes/NotePage'
import { RevealPage } from '../features/secrets/RevealPage'
import { SecretsPage } from '../features/secrets/SecretsPage'
import { SharePage } from '../features/share/SharePage'
import { usePreferences } from '../settings/store'
import { DialogHost } from '../ui/dialogs'
import { MenuHost } from '../ui/Menu'
import { Toasts } from '../ui/primitives'
import { RequireUser, SessionReady } from './SessionGate'
import { SessionWatcher } from './SessionWatcher'
import { SettingsPage } from './SettingsPage'
import { Shell } from './Shell'
import { queryClient } from './queryClient'
import { canUsePrivate, useReadySession } from './session'
import { applyTheme, watchSystemTheme } from './theme'

function ThemeSync() {
  const theme = usePreferences((s) => s.prefs.theme)
  const accent = usePreferences((s) => s.prefs.accent)
  const corners = usePreferences((s) => s.prefs.corners)
  const textSize = usePreferences((s) => s.prefs.textSize)
  const { bg, fg } = usePreferences((s) => s.prefs.customTheme)
  useEffect(() => {
    const apply = () => applyTheme({ theme, accent, corners, textSize, customTheme: { bg, fg } })
    apply()
    return watchSystemTheme(apply)
  }, [theme, accent, corners, textSize, bg, fg])
  return null
}

function Root() {
  return (
    <>
      <ScrollRestoration />
      <Outlet />
      <UploadTray />
      <MenuHost />
      <DialogHost />
      <Toasts />
    </>
  )
}

/** Only ever sends people to a path on this site. */
function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
}

function LoginRoute() {
  const session = useReadySession()
  const [params] = useSearchParams()
  return canUsePrivate(session) ? <Navigate to={safeNext(params.get('next'))} replace /> : <LoginPage session={session} />
}

const router = createBrowserRouter([{
  element: <Root />,
  children: [
    { path: '/s/:id', element: <RevealPage /> },
    { path: '/share/:token', element: <SharePage /> },
    {
      element: <SessionReady />,
      children: [
        { path: '/login', element: <LoginRoute /> },
        {
          element: <Shell />,
          children: [
            { path: '/forum', element: <ForumPage /> },
            { path: '/forum/:id', element: <PostPage /> },
            { path: '/settings', element: <SettingsPage /> },
            {
              element: <RequireUser />,
              children: [
                { path: '/forum/new', element: <PostEditor /> },
                { path: '/forum/:id/edit', element: <PostEditor /> },
                { index: true, element: <HomePage /> },
                { path: '/all', element: <ItemsPage /> },
                { path: '/notes', element: <ItemsPage kind="note" /> },
                { path: '/notes/:id', element: <NotePage /> },
                { path: '/boards', element: <ItemsPage kind="board" /> },
                { path: '/boards/:id', element: <BoardPage /> },
                { path: '/files', element: <ItemsPage kind="file" /> },
                { path: '/c/:id', element: <ItemsPage /> },
                { path: '/secrets', element: <SecretsPage /> },
                { path: '/trash', element: <TrashPage /> },
              ],
            },
          ],
        },
        { path: '*', element: <Navigate to="/" replace /> },
      ],
    },
  ],
}])

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeSync />
      <SessionWatcher />
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
