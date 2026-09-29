import { TICKET_RELATION_FILTERS } from '@/lib/board/ticket-relation-rule'
import { ASSIGNEE_NONE } from '@/lib/board/ticket-search'
import { AGENT_MCP_SERVER_NAME, MCP_SERVER_NAME } from '@/lib/mcp/mcp'
import { registerAgentSetupTool, registerAgentTools } from '@/lib/mcp/mcp-agent'
import { getBoardForMcp, listBoardsForMcp } from '@/lib/mcp/mcp-board'
import { registerImageTools } from '@/lib/mcp/mcp-image'
import { ACCEPTANCE_CRITERIA_GUIDE, mcpInstructions } from '@/lib/mcp/mcp-instructions'
import {
  addTicketCommentForMcp,
  createTicketForMcp,
  deleteTicketCommentForMcp,
  deleteTicketForMcp,
  getTicketForMcp,
  linkRelatedTicketForMcp,
  linkTicketArtifactForMcp,
  MCP_ASSIGNEE_ME,
  reportTicketCriteriaForMcp,
  searchTicketsForMcp,
  unlinkTicketArtifactForMcp,
  unlinkTicketRelationForMcp,
  updateTicketCommentForMcp,
  updateTicketForMcp,
} from '@/lib/mcp/mcp-ticket'
import type { ResourceAuth } from '@/lib/oauth/oauth-resource'
import {
  MAX_TICKET_CRITERIA,
  scCreateTicket,
  scPatchTicket,
  scTicketSearch,
  zChildOrder,
  zCommentContent,
  zCommentType,
  zCriterionItems,
  zCriterionReports,
  zCriterionText,
  zGitUrl,
  zRelatedTo,
  zRelationTarget,
  zTicketContent,
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

const PARENT_ID_DESCRIPTION =
  'Display ID (e.g. ABC-42) or ticket ID of the parent ticket. Must be a ticket on the same board'
const zMcpChildOrder = zChildOrder.describe(
  'Position under the parent (1-based). Children with the same value are ordered by number. Defaults to the end of the siblings',
)

const zMcpTicketContent = zTicketContent
  .optional()
  .describe('Ticket description (Markdown). Do not write completion conditions here; use acceptanceCriteria')

const ACCEPTANCE_CRITERIA_DESCRIPTION =
  'Acceptance criteria: where completion conditions / definition of done go. One verifiable sentence per item. Do not duplicate them in content'

const mcpCreateTicketSchema = scCreateTicket.extend({
  boardId: zBoardIdOrKey.describe('Board ID or board key (e.g. ABC). Find it with list_boards'),
  content: zMcpTicketContent,
  acceptanceCriteria: z
    .array(zCriterionText)
    .max(MAX_TICKET_CRITERIA)
    .optional()
    .describe(ACCEPTANCE_CRITERIA_DESCRIPTION),
  parentId: zRelationTarget.optional().describe(PARENT_ID_DESCRIPTION),
  childOrder: zMcpChildOrder.optional(),
})

/** Web の詳細画面と違い、ステータスと受け入れ条件の変更も同じツールで受ける */
const mcpUpdateTicketSchema = scPatchTicket.omit({ id: true }).extend({
  ticketId: z.string().min(1),
  status: zTicketStatus.optional(),
  content: zMcpTicketContent,
  acceptanceCriteria: zCriterionItems
    .optional()
    .describe(
      `${ACCEPTANCE_CRITERIA_DESCRIPTION}. Replaces all acceptance criteria. ` +
        'Pass existing items with their id from get_ticket acceptanceCriteria to keep their checked state ' +
        '(items whose text changes are reset to unchecked). Items not included in the list are deleted',
    ),
  parentId: zRelationTarget.nullish().describe(`${PARENT_ID_DESCRIPTION}. Pass null to remove the parent`),
  childOrder: zMcpChildOrder.optional(),
})

const mcpTicketSearchSchema = scTicketSearch.extend({
  boardId: zBoardIdOrKey.optional().describe('Board ID or board key (e.g. ABC)'),
  assignee: z
    .union([z.uuidv7(), z.literal(MCP_ASSIGNEE_ME), z.literal(ASSIGNEE_NONE)])
    .optional()
    .describe(`Assignee. User ID / '${MCP_ASSIGNEE_ME}' (yourself) / '${ASSIGNEE_NONE}' (unassigned)`),
  relatedTo: zRelatedTo.optional().describe('Filter by the display ID (e.g. ABC-42) of a related ticket'),
  relation: z
    .enum(TICKET_RELATION_FILTERS)
    .optional()
    .describe(
      'Relation as seen from the relatedTo ticket. child=direct children / related=related tickets / all=both (default)',
    ),
  limit: z.number().int().min(1).max(50).optional(),
})

export const createDevuntuMcpServer = (auth: ResourceAuth) => {
  const server = new McpServer(
    { name: SERVER_NAME[auth.kind], version: '1.0.0' },
    { instructions: mcpInstructions(auth.kind) },
  )

  server.registerTool(
    'ping',
    { title: 'Ping', description: 'Connectivity check. Returns the authorized user' },
    async () => ({
      content: [{ type: 'text' as const, text: `pong: ${auth.user.email}` }],
    }),
  )

  server.registerTool(
    'echo',
    {
      title: 'Echo',
      description: 'Returns the input string as is',
      inputSchema: { message: z.string().min(1) },
    },
    async ({ message }) => ({ content: [{ type: 'text' as const, text: message }] }),
  )

  server.registerTool(
    'list_boards',
    {
      title: 'List boards',
      description:
        'Returns the boards you can access. Before creating or searching tickets, identify the target board ID (or key) here. ' +
        'Assignee and tag candidates differ per board, so call get_board next',
      inputSchema: {
        includeArchived: z.boolean().optional().describe('Include archived boards. Excluded by default'),
      },
    },
    async ({ includeArchived }) => jsonResult(await listBoardsForMcp(auth, { includeArchived })),
  )

  server.registerTool(
    'get_board',
    {
      title: 'Get board',
      description:
        'Returns board details (members, tags, and ticket counts per status). ' +
        'Use the IDs returned here for assigneeId and tagIds in create_ticket / update_ticket',
      inputSchema: { boardId: z.string().min(1).describe('Board ID or board key (e.g. ABC)') },
    },
    async ({ boardId }) => jsonResult(await getBoardForMcp(auth, boardId)),
  )

  server.registerTool(
    'get_ticket',
    {
      title: 'Get ticket',
      description:
        'Gets ticket details by display ID (e.g. ABC-42) or ticket ID, including content, status, assignee, tags, comments, linked artifacts, ' +
        'parent/children, and related tickets. ' +
        'When working on the ticket, follow the steps in the workflow field of the response (doing when starting, posting plan / report, linking artifacts)',
      inputSchema: { ticketId: z.string().min(1) },
    },
    async ({ ticketId }) => jsonResult(await getTicketForMcp(auth, ticketId)),
  )

  server.registerTool(
    'search_tickets',
    {
      title: 'Search tickets',
      description: 'Searches accessible tickets by keyword, status, priority, tag, board, assignee, and related ticket',
      inputSchema: mcpTicketSearchSchema.shape,
    },
    async (input) => jsonResult(await searchTicketsForMcp(auth, input)),
  )

  server.registerTool(
    'create_ticket',
    {
      title: 'Create ticket',
      description: `Creates a new ticket on a board. Specify parentId to create it as a child ticket. ${ACCEPTANCE_CRITERIA_GUIDE}`,
      inputSchema: mcpCreateTicketSchema.shape,
    },
    async ({ acceptanceCriteria, ...input }) =>
      jsonResult(await createTicketForMcp(auth, { ...input, criteria: acceptanceCriteria })),
  )

  server.registerTool(
    'update_ticket',
    {
      title: 'Update ticket',
      description:
        'Updates ticket fields (title / content / priority / due date / assignee / tags / acceptance criteria / parent) and status. Set status to doing when you start working on it. ' +
        'Members cannot update tickets assigned to someone else (unassigned tickets are allowed; owners have no restriction). ' +
        ACCEPTANCE_CRITERIA_GUIDE,
      inputSchema: mcpUpdateTicketSchema.shape,
    },
    async ({ ticketId, acceptanceCriteria, ...input }) =>
      jsonResult(await updateTicketForMcp(auth, ticketId, { ...input, criteria: acceptanceCriteria })),
  )

  server.registerTool(
    'delete_ticket',
    {
      title: 'Delete ticket',
      description: 'Deletes a ticket. Both owners and members can delete only tickets they created',
      inputSchema: { ticketId: z.string().min(1) },
    },
    async ({ ticketId }) => jsonResult(await deleteTicketForMcp(auth, ticketId)),
  )

  server.registerTool(
    'add_ticket_comment',
    {
      title: 'Add comment',
      description:
        'Adds a comment to a ticket. Post with type=plan once you have a plan and type=report when you finish ' +
        '(record acceptance criteria results with report_acceptance_criteria, not in the report); ' +
        'these are shown collapsed on the detail screen, distinct from regular comments. Reply to an existing comment with parentId (one level only)',
      inputSchema: {
        ticketId: z.string().min(1),
        content: zCommentContent,
        type: zCommentType.describe('plan=work plan, report=work report. Omit for a regular comment'),
        parentId: z
          .uuidv7()
          .nullish()
          .describe(
            'ID of the parent comment to reply to. Cannot be a comment that is itself a reply (one level only)',
          ),
      },
    },
    async ({ ticketId, content, type, parentId }) =>
      jsonResult(await addTicketCommentForMcp(auth, ticketId, content, type, parentId)),
  )

  server.registerTool(
    'update_ticket_comment',
    {
      title: 'Update comment',
      description: 'Edits a comment you posted',
      inputSchema: { commentId: z.uuidv7(), content: zCommentContent },
    },
    async ({ commentId, content }) => jsonResult(await updateTicketCommentForMcp(auth, commentId, content)),
  )

  server.registerTool(
    'delete_ticket_comment',
    {
      title: 'Delete comment',
      description: 'Deletes a comment you posted, or any comment on a ticket you are allowed to delete',
      inputSchema: { commentId: z.uuidv7() },
    },
    async ({ commentId }) => jsonResult(await deleteTicketCommentForMcp(auth, commentId)),
  )

  server.registerTool(
    'link_ticket_artifact',
    {
      title: 'Link artifact',
      description:
        'Links a GitHub / GitLab branch / pull request (merge request) / commit URL to a ticket. ' +
        'The kind is detected from the URL. Link a pull request once created so its state and CI results appear on the ticket detail. ' +
        'For GitLab, only URLs of instances allowed by the server are accepted',
      inputSchema: {
        ticketId: z.string().min(1),
        url: zGitUrl.describe(
          'e.g. https://github.com/owner/repo/pull/123 / https://gitlab.com/group/project/-/merge_requests/12',
        ),
      },
    },
    async ({ ticketId, url }) => jsonResult(await linkTicketArtifactForMcp(auth, ticketId, url)),
  )

  server.registerTool(
    'unlink_ticket_artifact',
    {
      title: 'Unlink artifact',
      description:
        'Unlinks a branch / pull request (merge request) / commit from a ticket. Get linkId from links in get_ticket',
      inputSchema: { linkId: z.uuidv7() },
    },
    async ({ linkId }) => jsonResult(await unlinkTicketArtifactForMcp(auth, linkId)),
  )

  server.registerTool(
    'link_related_ticket',
    {
      title: 'Link related ticket',
      description:
        'Links two tickets on the same board as related (undirected; visible from both tickets). ' +
        'Set parent/child with parentId in update_ticket / create_ticket',
      inputSchema: {
        ticketId: z.string().min(1),
        relatedTicketId: zRelationTarget.describe('Display ID (e.g. ABC-42) or ticket ID of the ticket to link'),
      },
    },
    async ({ ticketId, relatedTicketId }) => jsonResult(await linkRelatedTicketForMcp(auth, ticketId, relatedTicketId)),
  )

  server.registerTool(
    'unlink_ticket_relation',
    {
      title: 'Unlink relation',
      description:
        'Removes a parent/child or related link. Get relationId from parent / children / related in get_ticket',
      inputSchema: { relationId: z.uuidv7() },
    },
    async ({ relationId }) => jsonResult(await unlinkTicketRelationForMcp(auth, relationId)),
  )

  // 画像の添付・取得は人間の利用者もエージェントも使う
  registerImageTools(server, auth)

  // セットアップ手順は人が読むものなので接続の種類を問わない
  registerAgentSetupTool(server)

  if (auth.kind === 'agent') {
    registerAgentTools(server, auth)
  } else {
    // エージェントは finish_agent_task の criteria で申告するので、人の経路にだけ出す
    server.registerTool(
      'report_acceptance_criteria',
      {
        title: 'Report acceptance criteria',
        description:
          'Records whether each acceptance criterion is met, with evidence, as a self-check shown on the ticket detail. ' +
          'Call it when you finish working on a ticket that has acceptance criteria, instead of listing the results in the type=report comment. ' +
          'Items not included keep their previous result',
        inputSchema: {
          ticketId: z.string().min(1),
          criteria: zCriterionReports('id from acceptanceCriteria in get_ticket')
            .min(1)
            .describe('Self-check result for each acceptance criterion'),
        },
      },
      async ({ ticketId, criteria }) => jsonResult(await reportTicketCriteriaForMcp(auth, ticketId, criteria)),
    )
  }

  return server
}
