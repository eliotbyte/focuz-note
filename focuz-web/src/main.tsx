import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Manrope weights used by DESIGN.md: 400 body, 600 emphasis, 700 titles, 800 display.
import '@fontsource/manrope/400.css'
import '@fontsource/manrope/600.css'
import '@fontsource/manrope/700.css'
import '@fontsource/manrope/800.css'
import './index.css'
import App from './App.tsx'
import PublicPage from './components/PublicPage'
import { registerSW } from 'virtual:pwa-register'
import { setupAppUpdates } from './lib/app-update'
import { applyStoredTheme } from './lib/theme'
import { AppToaster } from './ui/toaster'

applyStoredTheme()
setupAppUpdates(registerSW)

// Public links (/p/<token>) are read-only pages that work without signing in.
const publicToken = location.pathname.match(/^\/p\/([^/]+)\/?$/)?.[1]

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {publicToken ? <PublicPage token={decodeURIComponent(publicToken)} /> : <App />}
    {/* Outside App: the sign-in screen and public pages need toasts too (e.g. a new version). */}
    <AppToaster />
  </StrictMode>,
)
