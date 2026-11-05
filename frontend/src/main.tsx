import '@fontsource-variable/inter/index.css'
import './styles/tokens.css'
import './styles/base.css'
import './app/app.css'
import './app/board.css'
import './features/markdown/markdown.css'
import './auth/auth.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { applyTheme } from './app/theme'
import { usePreferences } from './settings/store'

// Before first render, so a stored theme never flashes. public/boot.js covers the paint before this runs.
applyTheme(usePreferences.getState().prefs)

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
