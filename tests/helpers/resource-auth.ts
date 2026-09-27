/**
 * MCP の認可情報(`ResourceAuth`)の偽データ
 *
 * 経路ごとに `kind` と `clientId` の意味が違う(OAuth はクライアント、pat / agent はトークン行の id)。
 */

import type { ResourceAuth } from '@/lib/oauth/oauth-resource'

type Override = Omit<Partial<ResourceAuth>, 'user'> & { user?: Partial<ResourceAuth['user']> }

const build = (base: ResourceAuth, override: Override = {}): ResourceAuth => ({
  ...base,
  ...override,
  user: { ...base.user, ...override.user },
})

/** 認可コードフローで得た JWT での接続 */
export const oauthAuth = (override?: Override): ResourceAuth =>
  build(
    {
      user: { id: 'u1', name: 'tester', email: 'test@example.com', role: null },
      scopes: ['mcp'],
      kind: 'oauth',
      clientId: 'test-client',
    },
    override,
  )

/** ユーザーが自分で発行した MCP トークンでの接続。`clientId` は McpToken の id */
export const patAuth = (override?: Override): ResourceAuth =>
  build(oauthAuth({ kind: 'pat', clientId: 'mcp-token-1' }), override)

/** エージェント用の長期トークンでの接続。`clientId` は AgentToken の id */
export const agentAuth = (override?: Override): ResourceAuth =>
  build(
    {
      user: { id: 'a1', name: 'agent', email: 'agent@agents.invalid', role: null },
      scopes: ['mcp'],
      kind: 'agent',
      clientId: 'token-1',
    },
    override,
  )
