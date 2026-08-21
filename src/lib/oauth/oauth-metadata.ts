import { auth, MCP_RESOURCE, MCP_SCOPE } from '@/lib/auth'
import { makeUrl } from '@/lib/server-utils'
import {
  metadataResponse,
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
  type ResourceServerMetadata,
} from '@better-auth/oauth-provider'

/**
 * OAuth / OIDC / MCP のディスカバリ文書。
 *
 * basePath が `/api/auth` なのでプラグインの well-known をそのまま公開できず、
 * ルートハンドラから呼ぶヘルパをここへ集約する。認可サーバーメタデータは
 * issuer 直下形式と RFC 8414 のパス挿入形式の双方から同じものを返す。
 */

/**
 * RP-initiated logout は提供しないので、ディスカバリからは `end_session_endpoint` を落とす。
 * クライアントによっては広告されているだけでログアウト連携を試みるため、載せない。
 */
const withoutEndSession = (handler: (request: Request) => Promise<Response>) => async (request: Request) => {
  const res = await handler(request)
  const metadata = (await res.json()) as Record<string, unknown>
  delete metadata.end_session_endpoint
  const cacheControl = res.headers.get('Cache-Control')
  return new Response(JSON.stringify(metadata), {
    status: res.status,
    headers: {
      'Content-Type': 'application/json',
      ...(cacheControl ? { 'Cache-Control': cacheControl } : {}),
    },
  })
}

/** RFC 8414 の認可サーバーメタデータ */
export const authServerMetadataHandler = withoutEndSession(oauthProviderAuthServerMetadata(auth))

/** OpenID Connect Discovery */
export const openIdConfigMetadataHandler = withoutEndSession(oauthProviderOpenIdConfigMetadata(auth))

/**
 * RFC 9728 の保護リソースメタデータ。
 * `resource` は認可要求の `resource` パラメータとして使われるので、
 * oauthProvider に登録した MCP_RESOURCE と必ず同じ値を返すこと。
 */
export const mcpResourceMetadataResponse = () => {
  const metadata: ResourceServerMetadata = {
    resource: MCP_RESOURCE,
    authorization_servers: [makeUrl('/api/auth').toString()],
    jwks_uri: makeUrl('/api/auth/jwks').toString(),
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Devuntu MCP',
  }
  return metadataResponse(metadata)
}

/** 401 応答に付ける、保護リソースメタデータの在り処(RFC 9728) */
export const MCP_RESOURCE_METADATA_URL = makeUrl('/.well-known/oauth-protected-resource/api/mcp').toString()
