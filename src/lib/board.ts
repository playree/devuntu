/**
 * ボード / チケットの認可判定と共有ミューテーション(サーバー専用)
 *
 * prisma に依存するため、クライアントからは import しないこと。
 * (クライアントからも使える純粋関数は `task.ts` を参照)
 *
 * 全ての Server Action はレコード単位の認可を `assertTicketAccess` / `assertBoardAccess` に通す。
 * `src/proxy.ts` の matcher は Server Action(next-action ヘッダ)を除外しているため、
 * middleware では守られない点に注意。
 */

import type { Prisma } from '@/generated/prisma/client'
import type { BoardKind, TicketStatus } from '@/generated/prisma/enums'
import { errInvalidOperation } from './error'
import { prisma } from './prisma'
import {
  evaluateTicketAccess,
  insertAt,
  PRIVATE_BOARD_NAME,
  reindexLane,
  resolveBoardRole,
  type BoardRole,
  type TicketPermission,
} from './task'

/** Server Action の `ctx.user` をそのまま渡せる最小形 */
export type Actor = { id: string; role?: string | null }

export const isAdminActor = (actor: Actor): boolean => actor.role === 'admin'

type Db = Prisma.TransactionClient | typeof prisma

/* -------------------------------------------------------------------------------------------------
 * ボード
 * -----------------------------------------------------------------------------------------------*/

export type BoardAccess = {
  boardId: string
  kind: BoardKind
  role: BoardRole
  /** 直接メンバーか、グループ経由か */
  via: 'member' | 'group'
  archived: boolean
}

/**
 * プライベートボード(1ユーザー1つ)を冪等に用意して boardId を返す。
 *
 * `/tickets` と `/boards` の入口 Server Action の先頭で呼ぶ。プライベートチケットは
 * このボードに属するため、これを通さないと `getAccessibleBoardIds` から漏れて
 * 自分のチケットが 1 件も見えなくなる。
 *
 * 一覧と選択肢の取得はクライアントから並行で走るため、同時に create が起きうる。
 * privateOwnerId の @unique に当たった場合(P2002)は読み直して吸収する。
 */
export const ensurePrivateBoard = async (user: { id: string }): Promise<string> => {
  const found = await prisma.board.findUnique({ where: { privateOwnerId: user.id }, select: { id: true } })
  if (found) {
    return found.id
  }

  try {
    const created = await prisma.board.create({
      data: {
        kind: 'private',
        privateOwnerId: user.id,
        // 表示は kind==='private' のときロケールへ差し替えるため、この値は画面に出ない
        name: PRIVATE_BOARD_NAME,
        members: { create: { userId: user.id, role: 'owner' } },
      },
      select: { id: true },
    })
    return created.id
  } catch (e) {
    const raced = await prisma.board.findUnique({ where: { privateOwnerId: user.id }, select: { id: true } })
    if (!raced) {
      throw e
    }
    return raced.id
  }
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
 * - manage : owner または管理者(管理画面から権限操作を代行できる)
 */
export const assertBoardAccess = async (
  actor: Actor,
  boardId: string,
  need: 'view' | 'manage',
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

export type BoardListItem = {
  id: string
  kind: BoardKind
  name: string
  description: string
  archived: boolean
  role: BoardRole
  via: 'member' | 'group'
}

/**
 * /boards の一覧表示用。自分がアサインされているボードのみをロール付きで返す。
 * BoardKind は enum の宣言順(private, team)で比較されるため、kind 昇順でプライベートが先頭に来る。
 */
export const listAccessibleBoards = async (
  userId: string,
  opts?: { includeArchived?: boolean },
): Promise<BoardListItem[]> => {
  const boards = await prisma.board.findMany({
    where: {
      ...(opts?.includeArchived ? {} : { archived: false }),
      OR: [{ members: { some: { userId } } }, { groups: { some: { group: { userGroups: { some: { userId } } } } } }],
    },
    select: {
      id: true,
      kind: true,
      name: true,
      description: true,
      archived: true,
      members: { where: { userId }, select: { role: true }, take: 1 },
      groups: {
        where: { group: { userGroups: { some: { userId } } } },
        select: { id: true },
        take: 1,
      },
    },
    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
  })

  return boards.flatMap(({ members, groups, description, ...board }) => {
    const directRole = members[0]?.role ?? null
    const role = resolveBoardRole(directRole, groups.length > 0)
    if (!role) {
      // where で絞っているため通常は到達しない
      return []
    }
    return [
      { ...board, description: description ?? '', role, via: directRole ? ('member' as const) : ('group' as const) },
    ]
  })
}

/** ボード単位・ステータス単位のチケット件数 */
export const countTicketsByBoard = async (
  boardIds: string[],
): Promise<Record<string, Partial<Record<TicketStatus, number>>>> => {
  if (boardIds.length === 0) {
    return {}
  }

  const rows = await prisma.ticket.groupBy({
    by: ['boardId', 'status'],
    where: { boardId: { in: boardIds } },
    _count: { _all: true },
  })

  const counts: Record<string, Partial<Record<TicketStatus, number>>> = {}
  for (const row of rows) {
    const byStatus = counts[row.boardId] ?? {}
    byStatus[row.status] = row._count._all
    counts[row.boardId] = byStatus
  }
  return counts
}

export type BoardUser = {
  id: string
  name: string
  email: string
  /** 直接メンバーのロール。グループ経由のみの場合は null */
  role: BoardRole | null
  via: 'member' | 'group'
}

/**
 * ボードのメンバー実体(直接メンバー ∪ グループ所属ユーザー)。
 * 担当者の選択肢やメンション候補に使う。全ユーザー一覧は返さない。
 */
export const getBoardMemberUsers = async (boardId: string, tx: Db = prisma): Promise<BoardUser[]> => {
  const board = await tx.board.findUnique({
    where: { id: boardId },
    select: {
      members: {
        select: { role: true, user: { select: { id: true, name: true, email: true } } },
      },
      groups: {
        select: {
          group: {
            select: { userGroups: { select: { user: { select: { id: true, name: true, email: true } } } } },
          },
        },
      },
    },
  })
  if (!board) {
    return []
  }

  const users = new Map<string, BoardUser>()
  for (const { role, user } of board.members) {
    users.set(user.id, { ...user, role, via: 'member' })
  }
  for (const { group } of board.groups) {
    for (const { user } of group.userGroups) {
      if (!users.has(user.id)) {
        users.set(user.id, { ...user, role: null, via: 'group' })
      }
    }
  }

  return [...users.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * ボードチケットの担当者がそのボードのメンバーかを検証する。NG なら errInvalidOperation()。
 * 担当者未指定(null/undefined)は未割り当てとして許可する。
 */
export const assertBoardAssignee = async (tx: Db, boardId: string, assigneeId?: string | null): Promise<void> => {
  if (!assigneeId) {
    return
  }

  const members = await getBoardMemberUsers(boardId, tx)
  if (!members.some((member) => member.id === assigneeId)) {
    throw errInvalidOperation()
  }
}

/**
 * グループ単位のアサイン(BoardGroup)を総入れ替えする。
 * ユーザー単位のアサイン(BoardMember)はメンバー 1 人ずつの upsert / delete で行うため、
 * こちらだけ総入れ替え方式になっている(権限境界も管理者のみで異なる)。
 */
export const syncBoardGroups = async (
  tx: Prisma.TransactionClient,
  boardId: string,
  groupIds: string[],
): Promise<void> => {
  await tx.boardGroup.deleteMany({ where: { boardId } })
  if (groupIds.length > 0) {
    await tx.boardGroup.createMany({ data: groupIds.map((groupId) => ({ boardId, groupId })) })
  }
}

/** 指定 ID のユーザー / グループがすべて存在するかを検証する */
export const assertBoardAssignmentTargets = async (
  tx: Db,
  { userIds, groupIds }: { userIds: string[]; groupIds: string[] },
): Promise<void> => {
  const [userCount, groupCount] = await Promise.all([
    userIds.length > 0 ? tx.user.count({ where: { id: { in: userIds } } }) : Promise.resolve(0),
    groupIds.length > 0 ? tx.group.count({ where: { id: { in: groupIds } } }) : Promise.resolve(0),
  ])

  if (userCount !== new Set(userIds).size || groupCount !== new Set(groupIds).size) {
    throw errInvalidOperation()
  }
}

/* -------------------------------------------------------------------------------------------------
 * チケット
 * -----------------------------------------------------------------------------------------------*/

export type TicketAccess = TicketPermission & {
  ticketId: string
  boardId: string
  /** プライベートボードかチームボードか。表示名の差し替えに使う */
  boardKind: BoardKind
  createdById: string | null
  assigneeId: string | null
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
    select: { id: true, boardId: true, createdById: true, assigneeId: true, status: true },
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

  const permission = evaluateTicketAccess({
    userId: actor.id,
    createdById: ticket.createdById,
    boardRole: access?.role ?? null,
    // アクセス不可なら boardRole が null になり書き込みは元々許可されないが、値は実態に合わせておく
    archived: board.archived,
  })

  const { id, ...rest } = ticket
  return { ticketId: id, ...rest, boardKind: board.kind, boardRole: access?.role ?? null, ...permission }
}

/** レコード単位の認可の入口。NG なら errInvalidOperation() を throw */
export const assertTicketAccess = async (
  actor: Actor,
  ticketId: string,
  need: 'view' | 'edit' | 'delete',
  tx: Db = prisma,
): Promise<TicketAccess> => {
  const access = await getTicketAccess(actor, ticketId, tx)
  if (!access) {
    throw errInvalidOperation()
  }

  const allowed = need === 'view' ? access.canView : need === 'edit' ? access.canEdit : access.canDelete
  if (!allowed) {
    throw errInvalidOperation()
  }

  return access
}

/**
 * メンション候補。そのボードの直接メンバー ∪ グループ所属ユーザー。
 * プライベートボードではメンバーが本人 1 人なので、自然に本人のみになる。
 */
export const getTicketMentionCandidates = async (
  access: TicketAccess,
  tx: Db = prisma,
): Promise<{ id: string; name: string }[]> => {
  const users = await getBoardMemberUsers(access.boardId, tx)
  return users.map(({ id, name }) => ({ id, name }))
}

/**
 * チケットのステータス / レーン位置を更新するコア。
 * かんばんの DnD・カード内メニュー・詳細画面のステータス変更が共有する唯一の経路。
 *
 * `index` を省略すると移動先レーンの末尾へ入る。
 * レーン内は 0..n-1 の連番へ再採番する(行ごとに異なる値なので updateMany は使えない)。
 */
export const moveTicketToLane = async (
  tx: Prisma.TransactionClient,
  { access, status, index }: { access: TicketAccess; status: TicketStatus; index?: number },
): Promise<{ id: string; status: TicketStatus; order: number }> => {
  // レーンは「同一ボード + 同一ステータス」で決まる
  const lane = await tx.ticket.findMany({
    where: { boardId: access.boardId, status },
    select: { id: true, order: true },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })

  const currentOrder = new Map(lane.map(({ id, order }) => [id, order]))
  const rest = lane.map((ticket) => ticket.id).filter((id) => id !== access.ticketId)
  const position = index ?? rest.length
  const ordered = reindexLane(insertAt(rest, access.ticketId, position))

  // 移動対象は status も変わるので 1 回の update にまとめる
  const moved = ordered.find(({ id }) => id === access.ticketId)
  const movedOrder = moved?.order ?? position
  await tx.ticket.update({ where: { id: access.ticketId }, data: { status, order: movedOrder } })

  // MAX_KANBAN_CARDS(500)まで入りうるレーンで毎回全行を UPDATE しないよう、order が変わる行だけ触る
  for (const { id, order } of ordered) {
    if (id === access.ticketId || currentOrder.get(id) === order) {
      continue
    }
    await tx.ticket.update({ where: { id }, data: { order } })
  }

  return { id: access.ticketId, status, order: movedOrder }
}
