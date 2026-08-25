import { MCP_RESOURCE, MCP_SCOPE } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { makeUrl } from '@/lib/server-utils'
import { createRemoteJWKSet, jwtVerify } from 'jose'

/**
 * 保護リソース(MCP サーバー)側のアクセストークン検証。
 *
 * 認可要求で `resource` を指定したトークンだけが JWT(RFC 9068)になり `aud` を持つ。
 * MCP クライアントは RFC 8707 の `resource` を送るので、ここは JWT 前提でよい。
 * `resource` 無しで発行される opaque トークンは署名を持たないため、そもそも検証を通らない。
 *
 * `node:crypto` と prisma に依存するのでクライアントからは import しないこと。
 */

const ISSUER = makeUrl('/api/auth').toString()

// jose 側でキャッシュされるので、モジュールスコープで 1 つだけ作る
const jwks = createRemoteJWKSet(makeUrl('/api/auth/jwks'))

export type ResourceAuthUser = {
  id: string
  name: string
  email: string
  role: string | null
}

export type ResourceAuth = {
  user: ResourceAuthUser
  scopes: string[]
  /**
   * トークンの出どころ。
   * `oauth` は認可コードフローで得た JWT、`agent` は AIエージェント用の長期トークン
   */
  kind: 'oauth' | 'agent'
  /** oauth: トークンを発行したクライアント(`azp`) / agent: AgentToken の id */
  clientId: string
}

export type ResourceAuthError = 'invalid_token' | 'insufficient_scope'

export type ResourceAuthResult = { ok: true; auth: ResourceAuth } | { ok: false; error: ResourceAuthError }

/** `Authorization: Bearer <token>` からトークンを取り出す */
export const parseBearerToken = (authorization: string | null): string | undefined => {
  const [scheme, token] = authorization?.split(' ') ?? []
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined
}

/**
 * MCP リソース向けアクセストークンを検証し、対応する devuntu ユーザーを返す。
 *
 * Web ログインセッションからは独立しており、ログアウトやセッション失効の影響を受けない。
 * 無効化はトークン自身の有効期限(アクセストークンは既定1時間、リフレッシュトークンは
 * `MCP_REFRESH_TOKEN_EXPIRES_IN`)、OAuth クライアントの無効化、ユーザー BAN で行う。
 */
export const verifyMcpAccessToken = async (token: string): Promise<ResourceAuthResult> => {
  let payload
  try {
    payload = (await jwtVerify(token, jwks, { issuer: ISSUER, audience: MCP_RESOURCE })).payload
  } catch (e) {
    logger.info({ error: e instanceof Error ? e.message : e }, 'mcp token verification failed')
    return { ok: false, error: 'invalid_token' }
  }

  const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : []
  if (!scopes.includes(MCP_SCOPE)) {
    return { ok: false, error: 'insufficient_scope' }
  }

  /**
   * 発行元クライアントの生存も見る。JWT は自己完結なので、これが無いと管理画面で無効化・削除した
   * クライアントのトークンが有効期限まで通り続けてしまう。better-auth のイントロスペクションと同じ扱い。
   */
  const clientId = typeof payload.azp === 'string' ? payload.azp : undefined
  if (!clientId) {
    return { ok: false, error: 'invalid_token' }
  }
  const client = await prisma.oauthClient.findUnique({ where: { clientId }, select: { disabled: true } })
  if (!client || client.disabled) {
    logger.info({ clientId }, 'mcp token client unavailable')
    return { ok: false, error: 'invalid_token' }
  }

  if (!payload.sub) {
    return { ok: false, error: 'invalid_token' }
  }
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, name: true, email: true, role: true, banned: true },
  })
  if (!user || user.banned) {
    logger.info({ userId: payload.sub }, 'mcp token user unavailable')
    return { ok: false, error: 'invalid_token' }
  }

  return {
    ok: true,
    auth: {
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      scopes,
      kind: 'oauth',
      clientId,
    },
  }
}
