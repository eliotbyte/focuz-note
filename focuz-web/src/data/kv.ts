import { getKV, setKV } from '../lib/db'

export async function get<T = string>(key: string, fallback?: T): Promise<T | undefined> {
  return getKV<T>(key, fallback)
}

export async function set(key: string, value: unknown): Promise<void> {
  return setKV(key, value)
}

