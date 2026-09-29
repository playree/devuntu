import type { TicketCommentType, TicketPriority, TicketStatus } from '@/generated/prisma/enums'
import { assertTicketAccess, findTicketIdByDisplayId, getAccessibleBoardIds } from '@/lib/board/board-access'
import {
  type AgentCriterionReport,
  assertAgentCriteria,
  listTicketCriteria,
  writeAgentCriteria,
} from '@/lib/board/ticket-criterion'
import { parseTicketDisplayId, ticketDisplayId, ticketShortPath } from '@/lib/board/ticket-id'
import { addTicketLink, listTicketLinks, removeTicketLink } from '@/lib/board/ticket-link'
import {
  addComment,
  createTicket,
  type CreateTicketInput,
  deleteComment,
  deleteTicket,
  type TicketAuthorize,
  updateComment,
  updateTicket,
  type UpdateTicketInput,
} from '@/lib/board/ticket-mutation'
import { canMcpDeleteTicket, canMcpUpdateTicket } from '@/lib/board/ticket-permission'
import {
  addTicketRelation,
  EMPTY_TICKET_RELATIONS,
  listTicketRelations,
  removeTicketRelation,
} from '@/lib/board/ticket-relation'
import type { TicketRelationFilter } from '@/lib/board/ticket-relation-rule'
import { buildTicketWhere, ticketListOrderBy } from '@/lib/board/ticket-search'
import { findWaitingTicketIds } from '@/lib/board/ticket-sequence'
import { errInvalidOperation } from '@/lib/error'
import { logger } from '@/lib/logger'
import { resolveBoardId } from '@/lib/mcp/mcp-board'
import { ticketWorkflowFor } from '@/lib/mcp/mcp-instructions'
import type { ResourceAuth } from '@/lib/oauth/oauth-resource'
import { prisma } from '@/lib/prisma'
import { parseChildProposal } from '@/lib/schema/schema-ticket'
import { makeUrl } from '@/lib/server-utils'
import { extractUploadKeys } from '@/lib/storage/upload'

/** 表示ID(ABC-42)でもチケットIDでも受け取れるようにする。エージェント向けツールからも使う */
export const resolveTicketId = async (auth: ResourceAuth, ticketIdOrDisplayId: string): Promise<string> => {
  if (!parseTicketDisplayId(ticketIdOrDisplayId)) {
    return ticketIdOrDisplayId
  }
  const id = await findTicketIdByDisplayId(auth.user, ticketIdOrDisplayId)
  if (!id) {
    throw errInvalidOperation()
  }
  return id
}

export const getTicketForMcp = async (auth: ResourceAuth, ticketIdOrDisplayId: string) => {
  const id = await resolveTicketId(auth, ticketIdOrDisplayId)
  const access = await assertTicketAccess(auth.user, id, 'view')

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    select: {
      number: true,
      board: { select: { name: true, key: true } },
      title: true,
      content: true,
      status: true,
      priority: true,
      dueDate: true,
      completedAt: true,
      tags: { select: { tag: { select: { name: true } } }, orderBy: { tag: { order: 'asc' } } },
      assignee: { select: { name: true } },
      createdBy: { select: { name: true } },
      childAdvance: true,
      createdAt: true,
      updatedAt: true,
      comments: {
        select: {
          id: true,
          content: true,
          type: true,
          decision: true,
          proposal: true,
          parentId: true,
          author: { select: { name: true } },
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!ticket) {
    throw errInvalidOperation()
  }

  const displayId = ticketDisplayId({ key: ticket.board.key, number: ticket.number })
  const [links, criteria, relations, waiting] = await Promise.all([
    listTicketLinks(id),
    listTicketCriteria(id),
    // 関係の相手は同じボードのチケットなので、ボードのメンバーでない承認者には見せない
    access.boardRole ? listTicketRelations(id) : EMPTY_TICKET_RELATIONS,
    // 順番待ちは兄弟の状態から出すので、関係と同じくボードのメンバーでない承認者には見せない
    findWaitingTicketIds(access.boardRole ? [id] : []),
  ])

  return {
    displayId,
    /** 本文・コメントに貼られた画像のキー。`get_image` で中身を見られることに気づけるよう返す */
    attachmentKeys: extractUploadKeys([ticket.content ?? '', ...ticket.comments.map((c) => c.content)].join('\n')),
    boardName: ticket.board.name,
    title: ticket.title,
    content: ticket.content,
    status: ticket.status,
    priority: ticket.priority,
    dueDate: ticket.dueDate,
    completedAt: ticket.completedAt,
    tags: ticket.tags.map(({ tag }) => tag.name),
    assigneeName: ticket.assignee?.name ?? '',
    createdByName: ticket.createdBy?.name ?? '',
    canEdit: access.canEdit,
    canDelete: access.canDelete,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    shortUrl: makeUrl(ticketShortPath(displayId)).toString(),
    /** 受け入れ条件。checked は人の最終確認、agentMet はエージェントの自己申告(null は未報告) */
    acceptanceCriteria: criteria.map((criterion) => ({
      id: criterion.id,
      text: criterion.text,
      checked: criterion.checkedAt !== null,
      agentMet: criterion.agentMet,
      agentEvidence: criterion.agentEvidence,
    })),
    comments: ticket.comments.map((comment) => ({
      id: comment.id,
      authorName: comment.author?.name ?? '',
      content: comment.content,
      /** plan=対応プラン / report=対応報告 / null=通常コメント */
      type: comment.type,
      /** plan / report への返答。approved=承認 / rejected=差し戻し / null=通常の返信 */
      decision: comment.decision,
      /** plan に付いた子チケットの起票案。承認すると子チケットとして起票される */
      proposal: parseChildProposal(comment.proposal),
      parentId: comment.parentId,
      createdAt: comment.createdAt,
    })),
    /** このチケットに対応するときの手順。instructions を読まないクライアントにも届くよう、応答にも載せる */
    workflow: ticketWorkflowFor(auth.kind, access.canEdit),
    /** 親チケット。参照は 1 階層だけ(親の親は返さない) */
    parent: relations.parent,
    /** 直下の子チケット。order は親の下での順番で、同じ値の子は番号順に並ぶ */
    children: relations.children,
    /** 子の進み具合(完了した子の数 / 子の数) */
    childProgress: relations.childProgress,
    /** 子が次の順番へ進む条件。done=前の兄弟が完了したら / reported=エージェントの報告済みでも進む */
    childAdvance: ticket.childAdvance,
    /** 前の順番の兄弟が済んでおらず、順番待ちか(エージェントはこの間このチケットを拾わない) */
    waitingForSiblings: waiting.has(id),
    /** 関連チケット。向きは無い */
    related: relations.related,
    /** 紐付けたブランチ / PR(MR) / コミット。prState と ci は GitHub / GitLab の Webhook で更新される */
    links: links.map(({ id: linkId, provider, kind, repo, ref, url, title, prState, ci }) => ({
      id: linkId,
      provider,
      kind,
      repo,
      ref,
      url,
      title,
      prState,
      ci,
    })),
  }
}

/** `search_tickets` の `assignee` に指定できる自分自身の別名。担当チケットの巡回に使う */
export const MCP_ASSIGNEE_ME = 'me'

export type McpTicketSearchInput = {
  keyword?: string
  status?: TicketStatus[]
  priority?: TicketPriority[]
  tags?: string[]
  /** ボードID またはボードキー(例: ABC) */
  boardId?: string
  /** ユーザーID / `me`(自分) / `none`(未割り当て) */
  assignee?: string
  /** 関係するチケットの表示ID */
  relatedTo?: string
  relation?: TicketRelationFilter
  limit?: number
}

/** `assignee` の指定を buildTicketWhere が解釈する形へ揃える */
const resolveAssignee = (assignee: string | undefined, userId: string): string | null =>
  assignee === MCP_ASSIGNEE_ME ? userId : (assignee ?? null)

const DEFAULT_SEARCH_LIMIT = 20
const MAX_SEARCH_LIMIT = 50

export const searchTicketsForMcp = async (auth: ResourceAuth, input: McpTicketSearchInput) => {
  const accessibleBoardIds = await getAccessibleBoardIds(auth.user.id)
  // 未知キーもアクセス外と同じ 0 件に寄せる(応答差でボードの存在を推測させない)
  const boardId = input.boardId ? await resolveBoardId(input.boardId, { allowUnknownKey: true }) : null
  const where = buildTicketWhere(
    {
      keyword: input.keyword ?? '',
      status: input.status ?? [],
      priority: input.priority ?? [],
      tags: input.tags ?? [],
      boardId,
      assignee: resolveAssignee(input.assignee, auth.user.id),
      relatedTo: input.relatedTo,
      relation: input.relation,
    },
    { accessibleBoardIds },
  )

  const tickets = await prisma.ticket.findMany({
    where,
    select: {
      number: true,
      title: true,
      status: true,
      priority: true,
      board: { select: { name: true, key: true } },
      assignee: { select: { name: true } },
      _count: { select: { comments: true } },
      updatedAt: true,
    },
    orderBy: ticketListOrderBy('updatedAt', 'descending'),
    take: Math.min(input.limit ?? DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT),
  })

  return tickets.map((ticket) => ({
    displayId: ticketDisplayId({ key: ticket.board.key, number: ticket.number }),
    boardName: ticket.board.name,
    title: ticket.title,
    status: ticket.status,
    priority: ticket.priority,
    assigneeName: ticket.assignee?.name ?? '',
    commentCount: ticket._count.comments,
    updatedAt: ticket.updatedAt,
  }))
}

export type McpCreateTicketInput = Omit<CreateTicketInput, 'boardId'> & {
  /** ボードID またはボードキー(例: ABC) */
  boardId: string
}

/**
 * MCP経由のチケット作成。追加制限は無く、Web版の createTicket アクションと同じ権限判定を使う。
 */
export const createTicketForMcp = async (auth: ResourceAuth, input: McpCreateTicketInput) => {
  const boardId = await resolveBoardId(input.boardId)
  const ticket = await createTicket(auth.user, { ...input, boardId })

  logger.info({ userId: auth.user.id, ticket }, 'mcp ticket created')
  return ticket
}

export type McpUpdateTicketInput = UpdateTicketInput

/** MCP限定の追加制限: メンバーは他人が担当のチケットを更新できない(canMcpUpdateTicket)。親子・関連の変更にも掛ける */
const mcpUpdateAuthorize =
  (auth: ResourceAuth): TicketAuthorize =>
  (access) => {
    if (!canMcpUpdateTicket({ userId: auth.user.id, boardRole: access.boardRole, assigneeId: access.assigneeId })) {
      throw errInvalidOperation()
    }
  }

/**
 * MCP経由のチケット更新(フィールド編集 + ステータス変更)。
 * メンバーは他人が担当のチケットを更新できない(canMcpUpdateTicket)という追加制限を挟む。
 */
export const updateTicketForMcp = async (
  auth: ResourceAuth,
  ticketIdOrDisplayId: string,
  input: McpUpdateTicketInput,
) => {
  const id = await resolveTicketId(auth, ticketIdOrDisplayId)
  const ticket = await updateTicket(auth.user, id, input, { authorize: mcpUpdateAuthorize(auth) })

  logger.info({ userId: auth.user.id, id }, 'mcp ticket updated')
  return ticket
}

/**
 * MCP経由のチケット削除。オーナー・メンバーいずれも自分が作成したチケットのみ削除できる
 * (canMcpDeleteTicket)。Web版の canDelete(owner または作成者)より厳しい。
 */
export const deleteTicketForMcp = async (auth: ResourceAuth, ticketIdOrDisplayId: string) => {
  const id = await resolveTicketId(auth, ticketIdOrDisplayId)
  await deleteTicket(auth.user, id, {
    authorize: (access) => {
      if (!canMcpDeleteTicket({ userId: auth.user.id, createdById: access.createdById })) {
        throw errInvalidOperation()
      }
    },
  })

  logger.info({ userId: auth.user.id, id }, 'mcp ticket deleted')
  return { id }
}

/**
 * コメント投稿。MCP限定の追加制限は無く、Web版の addTicketComment と同じ権限判定を使う。
 */
export const addTicketCommentForMcp = async (
  auth: ResourceAuth,
  ticketIdOrDisplayId: string,
  content: string,
  type?: TicketCommentType | null,
  parentId?: string | null,
) => {
  const ticketId = await resolveTicketId(auth, ticketIdOrDisplayId)
  const comment = await addComment(auth.user, { ticketId, content, type, parentId })

  logger.info({ userId: auth.user.id, ticketId, commentId: comment.id }, 'mcp ticket comment added')
  return { id: comment.id }
}

/**
 * コメント更新(投稿者本人のみ)。MCP限定の追加制限は無く、Web版の updateTicketComment と同じ。
 */
export const updateTicketCommentForMcp = async (auth: ResourceAuth, commentId: string, content: string) => {
  await updateComment(auth.user, commentId, content)

  logger.info({ userId: auth.user.id, commentId }, 'mcp ticket comment updated')
  return { id: commentId }
}

/**
 * コメント削除(投稿者本人、またはチケットを削除できる権限を持つ人)。
 * MCP限定の追加制限(canMcpDeleteTicket)は挟まず、Web版の deleteTicketComment と同じ。
 */
export const deleteTicketCommentForMcp = async (auth: ResourceAuth, commentId: string) => {
  await deleteComment(auth.user, commentId)

  logger.info({ userId: auth.user.id, commentId }, 'mcp ticket comment deleted')
  return { id: commentId }
}

/**
 * ブランチ / PR / コミットの URL をチケットに紐付ける。コメントの投稿と同じく、チケットを編集できれば登録できる。
 */
export const linkTicketArtifactForMcp = async (auth: ResourceAuth, ticketIdOrDisplayId: string, url: string) => {
  const ticketId = await resolveTicketId(auth, ticketIdOrDisplayId)
  const link = await addTicketLink(auth.user, ticketId, url)

  logger.info({ userId: auth.user.id, ticketId, linkId: link.id }, 'mcp ticket link added')
  return { id: link.id }
}

/** 紐付けを外す。linkId は get_ticket の links から得る */
export const unlinkTicketArtifactForMcp = async (auth: ResourceAuth, linkId: string) => {
  const { ticketId } = await removeTicketLink(auth.user, linkId)

  logger.info({ userId: auth.user.id, ticketId, linkId }, 'mcp ticket link removed')
  return { id: linkId }
}

/**
 * 関連チケットを付ける。相手は同じボードのチケットだけ。親子は update_ticket の parentId で扱う
 */
export const linkRelatedTicketForMcp = async (
  auth: ResourceAuth,
  ticketIdOrDisplayId: string,
  relatedTicketIdOrDisplayId: string,
) => {
  const ticketId = await resolveTicketId(auth, ticketIdOrDisplayId)
  const result = await addTicketRelation(
    auth.user,
    { ticketId, target: relatedTicketIdOrDisplayId, kind: 'related' },
    { authorize: mcpUpdateAuthorize(auth) },
  )

  logger.info({ userId: auth.user.id, ...result }, 'mcp related ticket linked')
  return { ticketId, relatedTicketId: result.targetId }
}

/** 親子・関連を外す。relationId は get_ticket の parent / children / related から得る */
export const unlinkTicketRelationForMcp = async (auth: ResourceAuth, relationId: string) => {
  const result = await removeTicketRelation(auth.user, relationId, { authorize: mcpUpdateAuthorize(auth) })

  logger.info({ userId: auth.user.id, ...result }, 'mcp ticket relation removed')
  return { id: relationId }
}

/**
 * 受け入れ条件ごとの充足と根拠を自己申告として記録する(人の経路の MCP クライアント向け)。
 * `update_ticket` と同じ制限を掛ける。他のチケットの項目が混ざっていたら何も記録しない
 */
export const reportTicketCriteriaForMcp = async (
  auth: ResourceAuth,
  ticketIdOrDisplayId: string,
  reports: AgentCriterionReport[],
) => {
  const ticketId = await resolveTicketId(auth, ticketIdOrDisplayId)
  await prisma.$transaction(async (tx) => {
    mcpUpdateAuthorize(auth)(await assertTicketAccess(auth.user, ticketId, 'edit', tx))
    await assertAgentCriteria(tx, ticketId, reports)
    await writeAgentCriteria(tx, reports)
  })

  logger.info({ userId: auth.user.id, ticketId, count: reports.length }, 'mcp ticket criteria reported')
  const criteria = await listTicketCriteria(ticketId)
  return {
    acceptanceCriteria: criteria.map(({ id, text, agentMet, agentEvidence }) => ({
      id,
      text,
      agentMet,
      agentEvidence,
    })),
  }
}
