import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/manrope/400.css'
import '@fontsource/manrope/700.css'
import './index.css'
import App from './App.tsx'
import { registerSW } from 'virtual:pwa-register'
import { notifyUpdateAvailable } from './ui/notify'
import { applyStoredTheme } from './lib/theme'

applyStoredTheme()

// A new build waits until the user reloads (reloading on its own could drop text being typed).
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    notifyUpdateAvailable(() => { void updateSW(true) })
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
