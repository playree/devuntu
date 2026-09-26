import { ASSIGNEE_NONE } from '@/lib/board/ticket-search'
import { AGENT_MCP_SERVER_NAME, MCP_SERVER_NAME } from '@/lib/mcp/mcp'
import { registerAgentSetupTool, registerAgentTools } from '@/lib/mcp/mcp-agent'
import { getBoardForMcp, listBoardsForMcp } from '@/lib/mcp/mcp-board'
import { registerImageTools } from '@/lib/mcp/mcp-image'
import {
  addTicketCommentForMcp,
  createTicketForMcp,
  deleteTicketCommentForMcp,
  deleteTicketForMcp,
  getTicketForMcp,
  linkTicketArtifactForMcp,
  MCP_ASSIGNEE_ME,
  searchTicketsForMcp,
  unlinkTicketArtifactForMcp,
  updateTicketCommentForMcp,
  updateTicketForMcp,
} from '@/lib/mcp/mcp-ticket'
import type { ResourceAuth } from '@/lib/oauth/oauth-resource'
import {
  scCreateTicket,
  scPatchTicket,
  scTicketSearch,
  zCommentContent,
  zCommentType,
  zGithubUrl,
  zTicketStatus,
} from '@/lib/schema/schema-ticket'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { jsonResult } from './mcp'

/**
 * devuntu の MCP サーバー本体。
 *
 * ステートレス運用(リクエストごとに生成)のため、認可済みユーザーはクロージャで閉じ込める。
 * チケット/ボード操作をツール化する際は、ここで auth.user を assertBoardAccess 等の
 * 既存の権限関数へそのまま渡して判定すること。
 *
 * 自動運用のツール(`mcp-agent.ts`)はエージェント用の長期トークンで接続した場合だけ登録する。
 * 人間の MCP クライアント(OAuth / ユーザー発行トークンのどちらも)には関係が無く、
 * 一覧に出しても誤用のもとにしかならないため。
 */

/**
 * MCP クライアントへ登録されるサーバー名。人間の経路はどちらも `devuntu` を名乗る。
 * 網羅を強制して、認証経路が増えたときにここの見直しをコンパイルエラーで気付けるようにする。
 */
const SERVER_NAME = {
  oauth: MCP_SERVER_NAME,
  pat: MCP_SERVER_NAME,
  agent: AGENT_MCP_SERVER_NAME,
} as const satisfies Record<ResourceAuth['kind'], string>

/**
 * チケット系ツールの入力。Web のスキーマから派生させ、MCP で違うところだけを差し替える。
 * - ボードは ID に加えてボードキーでも受ける(`resolveBoardId` が解決する)
 * - チケットは表示ID(ABC-42)でも受ける(`resolveTicketId` が解決する)
 */
const zBoardIdOrKey = z.string().min(1)

const mcpCreateTicketSchema = scCreateTicket.extend({
  boardId: zBoardIdOrKey.describe('ボードIDまたはボードキー(例: ABC)。list_boards で特定する'),
})

/** Web の詳細画面と違い、ステータスの変更も同じツールで受ける */
const mcpUpdateTicketSchema = scPatchTicket.omit({ id: true }).extend({
  ticketId: z.string().min(1),
  status: zTicketStatus.optional(),
})

const mcpTicketSearchSchema = scTicketSearch.extend({
  boardId: zBoardIdOrKey.optional().describe('ボードIDまたはボードキー(例: ABC)'),
  assignee: z
    .union([z.uuidv7(), z.literal(MCP_ASSIGNEE_ME), z.literal(ASSIGNEE_NONE)])
    .optional()
    .describe(`担当者。ユーザーID / '${MCP_ASSIGNEE_ME}'(自分) / '${ASSIGNEE_NONE}'(未割り当て)`),
  limit: z.number().int().min(1).max(50).optional(),
})

export const createDevuntuMcpServer = (auth: ResourceAuth) => {
  const server = new McpServer({ name: SERVER_NAME[auth.kind], version: '1.0.0' })

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
    'list_boards',
    {
      title: 'ボード一覧',
      description:
        'アクセスできるボードの一覧を返す。チケットを作成・検索する前に、対象ボードの ID(またはキー)を' +
        'ここで特定する。担当者やタグの候補はボードごとに異なるため、続けて get_board を呼ぶ',
      inputSchema: {
        includeArchived: z.boolean().optional().describe('アーカイブ済みのボードも含める。既定は含めない'),
      },
    },
    async ({ includeArchived }) => jsonResult(await listBoardsForMcp(auth, { includeArchived })),
  )

  server.registerTool(
    'get_board',
    {
      title: 'ボード詳細',
      description:
        'ボードの詳細(メンバー・タグ・ステータス別のチケット件数)を返す。' +
        'create_ticket / update_ticket の assigneeId と tagIds には、ここで得た ID を使う',
      inputSchema: { boardId: z.string().min(1).describe('ボードIDまたはボードキー(例: ABC)') },
    },
    async ({ boardId }) => jsonResult(await getBoardForMcp(auth, boardId)),
  )

  server.registerTool(
    'get_ticket',
    {
      title: 'チケット取得',
      description:
        '表示ID(例: ABC-42)またはチケットIDを指定して、本文・ステータス・担当者・タグ・コメントを含む詳細を取得する',
      inputSchema: { ticketId: z.string().min(1) },
    },
    async ({ ticketId }) => jsonResult(await getTicketForMcp(auth, ticketId)),
  )

  server.registerTool(
    'search_tickets',
    {
      title: 'チケット検索',
      description: 'キーワード・ステータス・優先度・タグ・ボード・担当者で、アクセス可能なチケットを検索する',
      inputSchema: mcpTicketSearchSchema.shape,
    },
    async (input) => jsonResult(await searchTicketsForMcp(auth, input)),
  )

  server.registerTool(
    'create_ticket',
    {
      title: 'チケット作成',
      description: 'ボードにチケットを新規作成する',
      inputSchema: mcpCreateTicketSchema.shape,
    },
    async (input) => jsonResult(await createTicketForMcp(auth, input)),
  )

  server.registerTool(
    'update_ticket',
    {
      title: 'チケット更新',
      description:
        'チケットの内容(タイトル/本文/優先度/期限/担当者/タグ)やステータスを更新する。' +
        'メンバーは他人が担当のチケットを更新できない(未割り当てなら可能。オーナーは制限なし)',
      inputSchema: mcpUpdateTicketSchema.shape,
    },
    async ({ ticketId, ...input }) => jsonResult(await updateTicketForMcp(auth, ticketId, input)),
  )

  server.registerTool(
    'delete_ticket',
    {
      title: 'チケット削除',
      description: 'チケットを削除する。オーナー・メンバーともに、自分が作成したチケットのみ削除できる',
      inputSchema: { ticketId: z.string().min(1) },
    },
    async ({ ticketId }) => jsonResult(await deleteTicketForMcp(auth, ticketId)),
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
    async ({ ticketId, content, type, parentId }) =>
      jsonResult(await addTicketCommentForMcp(auth, ticketId, content, type, parentId)),
  )

  server.registerTool(
    'update_ticket_comment',
    {
      title: 'コメント更新',
      description: '自分が投稿したコメントを編集する',
      inputSchema: { commentId: z.uuidv7(), content: zCommentContent },
    },
    async ({ commentId, content }) => jsonResult(await updateTicketCommentForMcp(auth, commentId, content)),
  )

  server.registerTool(
    'delete_ticket_comment',
    {
      title: 'コメント削除',
      description: '自分が投稿したコメント、またはチケットを削除できる権限を持つ場合にコメントを削除する',
      inputSchema: { commentId: z.uuidv7() },
    },
    async ({ commentId }) => jsonResult(await deleteTicketCommentForMcp(auth, commentId)),
  )

  server.registerTool(
    'link_ticket_artifact',
    {
      title: '成果物の紐付け',
      description:
        'GitHub のブランチ / プルリクエスト / コミットの URL をチケットに紐付ける。種別は URL から判定する。' +
        'プルリクエストを作ったら紐付けておくと、状態と CI の結果がチケット詳細に表示される',
      inputSchema: {
        ticketId: z.string().min(1),
        url: zGithubUrl.describe('例: https://github.com/owner/repo/pull/123'),
      },
    },
    async ({ ticketId, url }) => jsonResult(await linkTicketArtifactForMcp(auth, ticketId, url)),
  )

  server.registerTool(
    'unlink_ticket_artifact',
    {
      title: '成果物の紐付け解除',
      description:
        'チケットに紐付けたブランチ / プルリクエスト / コミットを外す。linkId は get_ticket の links から得る',
      inputSchema: { linkId: z.uuidv7() },
    },
    async ({ linkId }) => jsonResult(await unlinkTicketArtifactForMcp(auth, linkId)),
  )

  // 画像の添付・取得は人間の利用者もエージェントも使う
  registerImageTools(server, auth)

  // セットアップ手順は人が読むものなので接続の種類を問わない
  registerAgentSetupTool(server)

  if (auth.kind === 'agent') {
    registerAgentTools(server, auth)
  }

  return server
}
