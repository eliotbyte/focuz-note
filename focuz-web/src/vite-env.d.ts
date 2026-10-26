/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_APP_ENV?: string
  /** "false" hides the server choice on the sign-in screen (the app only uses VITE_API_BASE_URL). */
  readonly VITE_ALLOW_CUSTOM_SERVER?: string
}

declare module 'virtual:pwa-register' {
  export interface RegisterSWOptions {
    immediate?: boolean
    onNeedRefresh?: () => void
    onOfflineReady?: () => void
    onRegisterError?: (error: unknown) => void
    onRegisteredSW?: (swScriptUrl: string, registration: ServiceWorkerRegistration | undefined) => void
  }

  export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>
}

// mammoth's browser build has the same API as the package (whose main entry needs Node).
declare module 'mammoth/mammoth.browser.js' {
  import mammoth from 'mammoth'
  export default mammoth
}
