export type AppEnv = 'production' | 'test'

function readAppEnv(): AppEnv {
  const raw = String(((import.meta as any).env?.VITE_APP_ENV ?? '')).trim().toLowerCase()
  return raw === 'test' ? 'test' : 'production'
}

export const appEnv: AppEnv = readAppEnv()
export const isProduction = appEnv === 'production'
export const isTest = appEnv === 'test'

