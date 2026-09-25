/**
 * ボード / チケットの認可判定(サーバー専用)
 *
 * prisma に依存するため、クライアントからは import しないこと。
 * (DB を引かない権限の判定は `ticket-permission.ts` を参照)
 *
 * 全ての Server Action はレコード単位の認可を `assertTicketAccess` / `assertBoardAccess` に通す。
 * `src/proxy.ts` の matcher は Server Action(next-action ヘッダ)を除外しているため、
 * middleware では守られない点に注意。
 */

import type { BoardKind, TicketStatus } from '@/generated/prisma/enums'
import { approvableAgentWhere, isAgentApprover } from '../agent/agent-approver'
import { errInvalidOperation } from '../error'
import { prisma, type Db } from '../prisma'
import { toUploadUrl } from '../storage/upload'
import { parseTicketDisplayId } from './ticket-id'
import { evaluateTicketAccess, resolveBoardRole, type BoardRole, type TicketPermission } from './ticket-permission'

/** Server Action の `ctx.user` をそのまま渡せる最小形 */
export type Actor = { id: string; role?: string | null }

export const isAdminActor = (actor: Actor): boolean => actor.role === 'admin'

export type BoardAccess = {
  boardId: string
  kind: BoardKind
  role: BoardRole
  /** 直接メンバーか、グループ経由か */
  via: 'member' | 'group'
  archived: boolean
}

/**
 * ボードの構成変更(名称/説明/アーカイブ/削除/アサイン)が許されるかを検証する。
 * プライベートボードは 1 ユーザー 1 つの固定構成なので、管理者であっても変更させない。
 */
export const assertTeamBoard = async (tx: Db, boardId: string): Promise<void> => {
  const board = await tx.board.findUnique({ where: { id: boardId }, select: { kind: true } })
  if (!board || board.kind !== 'team') {
    throw errInvalidOperation()
  }
}

/**
 * ボードの可視判定。直接メンバー(BoardMember) または グループ経由(BoardGroup) を 1 クエリで解決する。
 * アクセス不可・ボード未存在は null。
 */
export const getBoardAccess = async (actor: Actor, boardId: string, tx: Db = prisma): Promise<BoardAccess | null> => {
  const board = await tx.board.findUnique({
    where: { id: boardId },
    select: {
      id: true,
      kind: true,
      archived: true,
      members: { where: { userId: actor.id }, select: { role: true }, take: 1 },
      groups: {
        where: { group: { userGroups: { some: { userId: actor.id } } } },
        select: { id: true },
        take: 1,
      },
    },
  })
  if (!board) {
    return null
  }

  const directRole = board.members[0]?.role ?? null
  const role = resolveBoardRole(directRole, board.groups.length > 0)
  if (!role) {
    return null
  }

  return { boardId, kind: board.kind, role, via: directRole ? 'member' : 'group', archived: board.archived }
}

/**
 * ボードへのアクセスを検証する。NG なら errInvalidOperation() を throw。
 * - view   : メンバー(owner|member)
 * - write  : メンバー かつ 未アーカイブ(アーカイブ済みボードは読み取り専用。evaluateTicketAccess と同じ方針)
 * - manage : owner または管理者(管理画面から権限操作を代行できる)
 */
export const assertBoardAccess = async (
  actor: Actor,
  boardId: string,
  need: 'view' | 'write' | 'manage',
  tx: Db = prisma,
): Promise<BoardAccess> => {
  const access = await getBoardAccess(actor, boardId, tx)
  if (!access) {
    if (need === 'manage' && isAdminActor(actor)) {
      // 管理者はアサインされていないボードでも管理操作のみ可能
      const board = await tx.board.findUnique({ where: { id: boardId }, select: { kind: true, archived: true } })
      if (!board) {
        throw errInvalidOperation()
      }
      return { boardId, kind: board.kind, role: 'owner', via: 'member', archived: board.archived }
    }
    throw errInvalidOperation()
  }

  if (need === 'manage' && access.role !== 'owner' && !isAdminActor(actor)) {
    throw errInvalidOperation()
  }
  if (need === 'write' && access.archived) {
    throw errInvalidOperation()
  }

  return access
}

/** 指定ユーザーがアクセスできるボードIDの一覧(チケットの可視スコープ構築に使う) */
export const getAccessibleBoardIds = async (
  userId: string,
  opts?: { includeArchived?: boolean },
  tx: Db = prisma,
): Promise<string[]> => {
  const boards = await tx.board.findMany({
    where: {
      ...(opts?.includeArchived ? {} : { archived: false }),
      OR: [{ members: { some: { userId } } }, { groups: { some: { group: { userGroups: { some: { userId } } } } } }],
    },
    select: { id: true },
  })
  return boards.map((board) => board.id)
}

/**
 * 表示ID(`KEY-番号`)からチケット ID を引く。形式外・未存在・アクセス不可はいずれも null。
 *
 * アクセス不可を未存在と区別せずに潰すことで、短縮URLが「そのチケットが在るか」と
 * 内部 ID を答えてしまわないようにする。
 *
 * ボードのメンバーでなくても、担当エージェントの承認者はそのチケットを閲覧できるので、
 * ボードに入れない場合はチケット単位の閲覧権限で判定し直す。
 */
export const findTicketIdByDisplayId = async (actor: Actor, raw: string): Promise<string | null> => {
  const parsed = parseTicketDisplayId(raw)
  if (!parsed) {
    return null
  }
  const board = await prisma.board.findUnique({ where: { key: parsed.key }, select: { id: true } })
  if (!board) {
    return null
  }
  const ticket = await prisma.ticket.findUnique({
    where: { boardId_number: { boardId: board.id, number: parsed.number } },
    select: { id: true },
  })
  if (!ticket) {
    return null
  }
  if (await getBoardAccess(actor, board.id)) {
    return ticket.id
  }
  return (await getTicketAccess(actor, ticket.id))?.canView ? ticket.id : null
}

/**
 * 添付を配信してよいか。配信API と MCP の画像取得で共通に使う。
 *
 * ボードに属さない添付(お知らせ / リンクウィジェットのアイコン)は全ログインユーザーへ配信する。
 * ボードのメンバーでない承認者には、承認対象(担当が自分の承認するエージェント)のチケット本文か
 * そのコメントから参照されている添付だけを許す。ボード単位で許すと、同じボードの無関係な
 * チケットの画像までキーさえ分かれば読めてしまう。
 */
export const canViewAttachment = async (
  actor: Actor,
  attachment: { key: string; boardId: string | null },
): Promise<boolean> => {
  const { key, boardId } = attachment
  if (!boardId) {
    return true
  }
  if (await getBoardAccess(actor, boardId)) {
    return true
  }
  const url = toUploadUrl(key)
  const count = await prisma.ticket.count({
    where: {
      boardId,
      assignee: approvableAgentWhere(actor.id),
      OR: [{ content: { contains: url } }, { comments: { some: { content: { contains: url } } } }],
    },
  })
  return count > 0
}

export type TicketAccess = TicketPermission & {
  ticketId: string
  boardId: string
  /** プライベートボードかチームボードか。表示名の差し替えに使う */
  boardKind: BoardKind
  createdById: string | null
  assigneeId: string | null
  /** 担当がエージェントか。エージェントモードを出し分ける画面側で使う */
  assigneeIsAgent: boolean
  status: TicketStatus
  boardRole: BoardRole | null
}

/**
 * チケット 1 件のアクセス実体。
 * プライベートチケットもプライベートボードに属するため、経路は 1 本で済む。
 */
export const getTicketAccess = async (
  actor: Actor,
  ticketId: string,
  tx: Db = prisma,
): Promise<TicketAccess | null> => {
  const ticket = await tx.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      boardId: true,
      createdById: true,
      assigneeId: true,
      status: true,
      assignee: { select: { isAgent: true } },
    },
  })
  if (!ticket) {
    return null
  }

  const access = await getBoardAccess(actor, ticket.boardId, tx)
  const board =
    access ?? (await tx.board.findUnique({ where: { id: ticket.boardId }, select: { kind: true, archived: true } }))
  if (!board) {
    // ボードが消えていればチケットも Cascade で消えるため通常は到達しない
    return null
  }

  // 担当がエージェントのときだけ承認者を引く(人間担当・未割り当てでは問い合わせない)
  const approver =
    ticket.assigneeId && ticket.assignee?.isAgent ? await isAgentApprover(actor.id, ticket.assigneeId, tx) : false

  const permission = evaluateTicketAccess({
    userId: actor.id,
    createdById: ticket.createdById,
    boardRole: access?.role ?? null,
    // アクセス不可なら boardRole が null になり書き込みは元々許可されないが、値は実態に合わせておく
    archived: board.archived,
    isAgentApprover: approver,
  })

  const { id, assignee, ...rest } = ticket
  return {
    ticketId: id,
    ...rest,
    assigneeIsAgent: assignee?.isAgent ?? false,
    boardKind: board.kind,
    boardRole: access?.role ?? null,
    ...permission,
  }
}

/**
 * レコード単位の認可の入口。NG なら errInvalidOperation() を throw。
 * `agentMode` はエージェントモードの変更専用で、ボードの権限ではなく承認者かどうかで決まる。
 */
export const assertTicketAccess = async (
  actor: Actor,
  ticketId: string,
  need: 'view' | 'edit' | 'delete' | 'agentMode',
  tx: Db = prisma,
): Promise<TicketAccess> => {
  const access = await getTicketAccess(actor, ticketId, tx)
  if (!access) {
    throw errInvalidOperation()
  }

  const allowed = {
    view: access.canView,
    edit: access.canEdit,
    delete: access.canDelete,
    agentMode: access.canEditAgentMode,
  }[need]
  if (!allowed) {
    throw errInvalidOperation()
  }

  return access
}
