import { MCP_SCOPE } from '@/lib/auth'
import { MCP_RESOURCE_METADATA_URL } from '@/lib/oauth-metadata'
import { parseBearerToken, verifyMcpAccessToken, type ResourceAuthError } from '@/lib/oauth-resource'

/**
 * MCP サーバーの入口。
 *
 * 現時点では認可だけを担い、MCP プロトコルの応答は実装していない。
 * 未認証のクライアントには RFC 9728 の `resource_metadata` を返し、そこから
 * 認可サーバーのメタデータ → 動的クライアント登録 → 認可フローへ進めるようにする。
 */

/**
 * RFC 6750 のチャレンジ。resource_metadata でクライアントに認可サーバーの探し方を教える。
 * スキームとパラメータは空白区切り、パラメータ同士はカンマ区切りにする。
 */
const challenge = (error?: ResourceAuthError) => {
  const params = [
    `resource_metadata="${MCP_RESOURCE_METADATA_URL}"`,
    ...(error ? [`error="${error}"`] : []),
    ...(error === 'insufficient_scope' ? [`scope="${MCP_SCOPE}"`] : []),
  ]
  return `Bearer ${params.join(', ')}`
}

const unauthorized = (error?: ResourceAuthError) =>
  Response.json(
    { error: error ?? 'invalid_token' },
    {
      status: error === 'insufficient_scope' ? 403 : 401,
      headers: { 'WWW-Authenticate': challenge(error), 'Cache-Control': 'no-store' },
    },
  )

const handler = async (request: Request) => {
  const token = parseBearerToken(request.headers.get('authorization'))
  if (!token) {
    return unauthorized()
  }

  const result = await verifyMcpAccessToken(token)
  if (!result.ok) {
    return unauthorized(result.error)
  }

  // TODO: MCP プロトコルの実装。ツールの権限判定は result.auth.user を画面と同じ権限関数へ渡す
  return Response.json({ error: 'not_implemented' }, { status: 501, headers: { 'Cache-Control': 'no-store' } })
}

export const GET = handler
export const POST = handler
