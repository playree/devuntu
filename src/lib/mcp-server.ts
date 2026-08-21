import { getTicketForMcp, searchTicketsForMcp } from '@/lib/mcp-ticket'
import type { ResourceAuth } from '@/lib/oauth/oauth-resource'
import { TICKET_PRIORITIES, TICKET_STATUSES } from '@/lib/task'
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

  server.registerTool(
    'get_ticket',
    {
      title: 'チケット取得',
      description:
        '表示ID(例: ABC-42)またはチケットIDを指定して、本文・ステータス・担当者・タグ・コメントを含む詳細を取得する',
      inputSchema: { ticketId: z.string().min(1) },
    },
    async ({ ticketId }) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(await getTicketForMcp(auth, ticketId), null, 2) }],
    }),
  )

  server.registerTool(
    'search_tickets',
    {
      title: 'チケット検索',
      description: 'キーワード・ステータス・優先度・タグ・ボードで、アクセス可能なチケットを検索する',
      inputSchema: {
        keyword: z.string().max(100).optional(),
        status: z.array(z.enum(TICKET_STATUSES)).optional(),
        priority: z.array(z.enum(TICKET_PRIORITIES)).optional(),
        tags: z.array(z.string()).optional(),
        boardId: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async (input) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(await searchTicketsForMcp(auth, input), null, 2) }],
    }),
  )

  return server
}
