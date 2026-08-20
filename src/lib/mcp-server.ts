import type { ResourceAuth } from '@/lib/oauth-resource'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

/**
 * devuntu の MCP サーバー本体。
 *
 * ステートレス運用(リクエストごとに生成)のため、認可済みユーザーはクロージャで閉じ込める。
 * チケット/ボード操作をツール化する際は、ここで auth.user を assertBoardAccess 等の
 * 既存の権限関数へそのまま渡して判定すること。
 */
export const createDevuntuMcpServer = (auth: ResourceAuth) => {
  const server = new McpServer({ name: 'devuntu', version: '1.0.0' })

  server.registerTool('ping', { title: 'Ping', description: '接続確認用。認可済みユーザーの情報を返す' }, async () => ({
    content: [{ type: 'text' as const, text: `pong: ${auth.user.email}` }],
  }))

  server.registerTool(
    'echo',
    {
      title: 'Echo',
      description: '入力した文字列をそのまま返す',
      inputSchema: { message: z.string().min(1) },
    },
    async ({ message }) => ({ content: [{ type: 'text' as const, text: message }] }),
  )

  return server
}
