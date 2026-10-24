// Personal API tokens for agents (MCP). Managed from Settings → Agents; the server only accepts
// these requests from a signed-in session, never from a token.
import { api } from './api'

export type ApiTokenScope = 'read' | 'write'

export interface ApiTokenInfo {
  id: number
  name: string
  prefix: string
  scope: ApiTokenScope
  createdAt: string
  lastUsedAt: string | null
}

export interface CreatedApiToken {
  /** The secret. The server returns it only in this response. */
  token: string
  info: ApiTokenInfo
}

export async function listApiTokens(): Promise<ApiTokenInfo[]> {
  const resp = await api('/me/api-tokens')
  return (resp?.data ?? []) as ApiTokenInfo[]
}

export async function createApiToken(name: string, scope: ApiTokenScope): Promise<CreatedApiToken> {
  const resp = await api('/me/api-tokens', { method: 'POST', body: JSON.stringify({ name, scope }) })
  return resp.data as CreatedApiToken
}

export async function revokeApiToken(id: number): Promise<void> {
  await api(`/me/api-tokens/${id}`, { method: 'DELETE' })
}
