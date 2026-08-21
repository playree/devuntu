import { MCP_SCOPE } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { createDevuntuMcpServer } from '@/lib/mcp-server'
import { MCP_RESOURCE_METADATA_URL } from '@/lib/oauth/oauth-metadata'
import { parseBearerToken, verifyMcpAccessToken, type ResourceAuthError } from '@/lib/oauth/oauth-resource'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

/**
 * MCP サーバーの入口。
 *
 * 未認証のクライアントには RFC 9728 の `resource_metadata` を返し、そこから
 * 認可サーバーのメタデータ → 動的クライアント登録 → 認可フローへ進めるようにする。
 * 認可済みのリクエストは MCP プロトコル(Streamable HTTP)のハンドラへ委譲する。
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

/**
 * 通知を使わない最小構成のため、GET(サーバー→クライアント通知用SSE確立)と
 * DELETE(セッション終了)には対応しない。
 */
const methodNotAllowed = () =>
  Response.json(
    { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null },
    { status: 405, headers: { 'Cache-Control': 'no-store' } },
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

  if (request.method !== 'POST') {
    return methodNotAllowed()
  }

  const server = createDevuntuMcpServer(result.auth)
  // ステートレストランスポートはリクエストごとに新規生成する必要がある
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })

  try {
    await server.connect(transport)
    return await transport.handleRequest(request)
  } catch (e) {
    logger.error({ error: e instanceof Error ? e.message : e }, 'mcp request failed')
    return Response.json(
      { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}

export const GET = handler
export const POST = handler
