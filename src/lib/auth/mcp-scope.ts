/**
 * OIDC プロバイダ / MCP サーバーのスコープとリソース識別子
 *
 * `auth.ts` は import するだけで betterAuth を初期化するため、定数だけを参照したい
 * トークン検証やメタデータの経路からはこちらを使う。
 */

import { makeUrl } from '../server-utils'

// oauthProvider(自身がOIDCプロバイダとして提供)用のスコープ(OIDCログイン用)
export const OIDC_PROVIDER_SCOPES = ['openid', 'profile', 'email'] as const

/** MCP サーバーへのアクセスを表すスコープ。同意画面で何を許可するのかを利用者に見せるために分けてある */
export const MCP_SCOPE = 'mcp'

/**
 * 動的登録されたクライアント(= MCP クライアント)に与えるスコープ。
 * 長時間の接続で refresh token を使うため offline_access を含む。
 */
export const MCP_SCOPES = [...OIDC_PROVIDER_SCOPES, 'offline_access', MCP_SCOPE] as const

/**
 * MCP サーバーのリソース識別子(RFC 8707 の `resource`)。
 *
 * クライアントがこの値を要求したときだけアクセストークンが JWT(RFC 9068)になり `aud` が載る。
 * `/.well-known/oauth-protected-resource/api/mcp` が返す `resource` と必ず同じ値にすること。
 */
export const MCP_RESOURCE = makeUrl('/api/mcp').toString()
