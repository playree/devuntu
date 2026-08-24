import {
  addTicketCommentForMcp,
  createTicketForMcp,
  deleteTicketCommentForMcp,
  deleteTicketForMcp,
  getTicketForMcp,
  MCP_ASSIGNEE_ME,
  searchTicketsForMcp,
  updateTicketCommentForMcp,
  updateTicketForMcp,
} from '@/lib/mcp-ticket'
import type { ResourceAuth } from '@/lib/oauth/oauth-resource'
import { zCommentContent, zCommentType, zDueDate, zTagIds, zTicketContent, zTicketTitle } from '@/lib/schema'
import { ASSIGNEE_NONE, TICKET_PRIORITIES, TICKET_STATUSES } from '@/lib/task'
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
      description: 'キーワード・ステータス・優先度・タグ・ボード・担当者で、アクセス可能なチケットを検索する',
      inputSchema: {
        keyword: z.string().max(100).optional(),
        status: z.array(z.enum(TICKET_STATUSES)).optional(),
        priority: z.array(z.enum(TICKET_PRIORITIES)).optional(),
        tags: z.array(z.string()).optional(),
        boardId: z.string().optional(),
        assignee: z
          .string()
          .optional()
          .describe(`担当者。ユーザーID / '${MCP_ASSIGNEE_ME}'(自分) / '${ASSIGNEE_NONE}'(未割り当て)`),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async (input) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(await searchTicketsForMcp(auth, input), null, 2) }],
    }),
  )

  server.registerTool(
    'create_ticket',
    {
      title: 'チケット作成',
      description: 'ボードにチケットを新規作成する',
      inputSchema: {
        boardId: z.string().min(1),
        title: zTicketTitle,
        content: zTicketContent.optional(),
        status: z.enum(TICKET_STATUSES).default('todo'),
        priority: z.enum(TICKET_PRIORITIES).default('medium'),
        dueDate: zDueDate,
        assigneeId: z.uuidv7().nullish(),
        tagIds: zTagIds.optional(),
      },
    },
    async (input) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(await createTicketForMcp(auth, input), null, 2) }],
    }),
  )

  server.registerTool(
    'update_ticket',
    {
      title: 'チケット更新',
      description:
        'チケットの内容(タイトル/本文/優先度/期限/担当者/タグ)やステータスを更新する。' +
        'メンバーは他人が担当のチケットを更新できない(未割り当てなら可能。オーナーは制限なし)',
      inputSchema: {
        ticketId: z.string().min(1),
        title: zTicketTitle.optional(),
        content: zTicketContent.optional(),
        priority: z.enum(TICKET_PRIORITIES).optional(),
        dueDate: zDueDate,
        assigneeId: z.uuidv7().nullish(),
        tagIds: zTagIds.optional(),
        status: z.enum(TICKET_STATUSES).optional(),
      },
    },
    async ({ ticketId, ...input }) => ({
      content: [
        { type: 'text' as const, text: JSON.stringify(await updateTicketForMcp(auth, ticketId, input), null, 2) },
      ],
    }),
  )

  server.registerTool(
    'delete_ticket',
    {
      title: 'チケット削除',
      description: 'チケットを削除する。オーナー・メンバーともに、自分が作成したチケットのみ削除できる',
      inputSchema: { ticketId: z.string().min(1) },
    },
    async ({ ticketId }) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(await deleteTicketForMcp(auth, ticketId), null, 2) }],
    }),
  )

  server.registerTool(
    'add_ticket_comment',
    {
      title: 'コメント追加',
      description:
        'チケットにコメントを追加する。対応プランは type=plan、対応完了の報告は type=report として残すと' +
        '詳細画面で折りたたみ表示され、通常コメントと区別できる。既存コメントへの返信は parentId で指定できる(1階層のみ)',
      inputSchema: {
        ticketId: z.string().min(1),
        content: zCommentContent,
        type: zCommentType.describe('plan=対応プラン、report=対応報告。通常コメントは省略する'),
        parentId: z.uuidv7().nullish().describe('返信先の親コメントID。親自体が返信の場合は指定できない(1階層のみ)'),
      },
    },
    async ({ ticketId, content, type, parentId }) => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(await addTicketCommentForMcp(auth, ticketId, content, type, parentId), null, 2),
        },
      ],
    }),
  )

  server.registerTool(
    'update_ticket_comment',
    {
      title: 'コメント更新',
      description: '自分が投稿したコメントを編集する',
      inputSchema: { commentId: z.uuidv7(), content: zCommentContent },
    },
    async ({ commentId, content }) => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(await updateTicketCommentForMcp(auth, commentId, content), null, 2),
        },
      ],
    }),
  )

  server.registerTool(
    'delete_ticket_comment',
    {
      title: 'コメント削除',
      description: '自分が投稿したコメント、またはチケットを削除できる権限を持つ場合にコメントを削除する',
      inputSchema: { commentId: z.uuidv7() },
    },
    async ({ commentId }) => ({
      content: [
        { type: 'text' as const, text: JSON.stringify(await deleteTicketCommentForMcp(auth, commentId), null, 2) },
      ],
    }),
  )

  return server
}
