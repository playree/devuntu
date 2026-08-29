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

import { Prisma } from '@/generated/prisma/client'
import type { BoardKind, TicketStatus } from '@/generated/prisma/enums'
import { isAgentApprover } from '../agent/agent-approver'
import { nowDate } from '../day'
import { errClient, errInvalidOperation } from '../error'
import { isUniqueViolation, prisma } from '../prisma'
import { extractUploadKeys } from '../storage/upload'
import {
  evaluateTicketAccess,
  insertAt,
  kanbanDoneSince,
  kanbanLaneWhere,
  nextSequentialKey,
  parseTicketDisplayId,
  PRIVATE_BOARD_KEY_PREFIX,
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

/** 重複するボードキーは DB の @unique で弾かれる。クライアントへ専用コードで返す */
const DUPLICATED_BOARD_KEY = 'DUPLICATED_BOARD_KEY'

/** キー重複の一意制約違反を DUPLICATED_BOARD_KEY へ変換して再 throw する */
export const rethrowDuplicatedBoardKey = (e: unknown): never => {
  if (isUniqueViolation(e)) {
    throw errClient(DUPLICATED_BOARD_KEY)
  }
  throw e
}

/**
 * ボードキーを履歴(BoardKeyHistory)へ登録して占有する。他ボードが使ったことのあるキーなら
 * DUPLICATED_BOARD_KEY。
 *
 * `Board.key` の @unique だけでは「改名 / 削除で手放したキーを別ボードが取る」ことを防げず、
 * 共有済みの表示ID(`KEY-番号`)が別ボードの同番号チケットへ解決されてしまう。
 * 履歴の行はボードを消しても残すので、一度使ったキーが別のボードへ渡ることはない。
 *
 * 自分が以前使っていたキーへ戻す場合だけは許す(表示IDの指す先が変わらないため)。
 * `boardId` 未指定は新規作成 = まだ手放したキーを持たないので、履歴があれば必ず拒否になる。
 *
 * ボードの作成 / キー変更と同じトランザクションで呼ぶこと(失敗時にキーを焼かないため)。
 */
export const reserveBoardKey = async (tx: Prisma.TransactionClient, key: string, boardId?: string): Promise<void> => {
  const used = await tx.boardKeyHistory.findUnique({ where: { key }, select: { boardId: true } })
  if (used) {
    if (!boardId || used.boardId !== boardId) {
      throw errClient(DUPLICATED_BOARD_KEY)
    }
    return
  }

  await tx.boardKeyHistory.create({ data: { key, boardId }, select: { key: true } }).catch(rethrowDuplicatedBoardKey)
}

/** ensurePrivateBoard のキー競合によるリトライ回数。キーの取り合いは同時実行数ぶんしか起きない */
const PRIVATE_BOARD_CREATE_RETRY = 3

/**
 * プライベートボードのキー(PRV<連番>)。既存の最大 + 1 を採る。
 * 桁が MAX_BOARD_KEY を超えると表示IDを解決できないボードになるため、その手前で失敗させる。
 *
 * 採番の母集団は現存ボードではなく履歴(BoardKeyHistory)。退会などでプライベートボードが
 * 消えても、その番号を別ユーザーへ再発行しない(共有済みの表示IDが別人のチケットを指さない)。
 * PRV 接頭辞はチームボードのキー入力から `isReservedBoardKey` で除外してあるため、
 * ここの母集団に利用者が作ったキーが混ざることはない。
 */
const nextPrivateBoardKey = async (tx: Prisma.TransactionClient): Promise<string> => {
  const used = await tx.boardKeyHistory.findMany({
    where: { key: { startsWith: PRIVATE_BOARD_KEY_PREFIX } },
    select: { key: true },
  })
  const key = nextSequentialKey(
    PRIVATE_BOARD_KEY_PREFIX,
    used.map(({ key }) => key),
  )
  if (!key) {
    throw errInvalidOperation()
  }
  return key
}

/**
 * プライベートボード(1ユーザー1つ)を冪等に用意して boardId を返す。
 *
 * `/tickets` と `/boards` の入口 Server Action の先頭で呼ぶ。プライベートチケットは
 * このボードに属するため、これを通さないと `getAccessibleBoardIds` から漏れて
 * 自分のチケットが 1 件も見えなくなる。
 *
 * 一覧と選択肢の取得はクライアントから並行で走るため、同時に create が起きうる。
 * privateOwnerId の @unique に当たったなら読み直して吸収し、キーの取り合いに負けた場合は
 * 採番からやり直す(自分のボードはまだ無いので読み直しでは吸収できない)。
 * 一意制約違反以外(接続断など)はリトライしても直らないので即座に投げ直す。
 *
 * キーの登録に `reserveBoardKey` を使わないのは、あちらが一意制約違反を ClientError へ
 * 変換してしまい、ここのリトライ判定(isUniqueViolation)に掛からなくなるため。
 */
export const ensurePrivateBoard = async (user: { id: string }): Promise<string> => {
  const found = await prisma.board.findUnique({ where: { privateOwnerId: user.id }, select: { id: true } })
  if (found) {
    return found.id
  }

  for (let attempt = 1; ; attempt++) {
    try {
      // 採番・履歴への登録・ボード作成を 1 トランザクションにまとめ、負けた側がキーを焼かないようにする
      return await prisma.$transaction(async (tx) => {
        const key = await nextPrivateBoardKey(tx)
        const created = await tx.board.create({
          data: {
            kind: 'private',
            privateOwnerId: user.id,
            key,
            // 表示は kind==='private' のときロケールへ差し替えるため、この値は画面に出ない
            name: PRIVATE_BOARD_NAME,
            members: { create: { userId: user.id, role: 'owner' } },
          },
          select: { id: true },
        })
        await tx.boardKeyHistory.create({ data: { key, boardId: created.id }, select: { key: true } })
        return created.id
      })
    } catch (e) {
      if (!isUniqueViolation(e)) {
        throw e
      }
      const raced = await prisma.board.findUnique({ where: { privateOwnerId: user.id }, select: { id: true } })
      if (raced) {
        return raced.id
      }
      if (attempt >= PRIVATE_BOARD_CREATE_RETRY) {
        throw e
      }
    }
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
  /** チケット表示IDの接頭辞 */
  key: string
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
      key: true,
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
  /** アバター画像。OIDC のプロフィール由来なので未設定の場合がある */
  image: string | null
  isAgent: boolean
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
        select: {
          role: true,
          user: { select: { id: true, name: true, email: true, image: true, isAgent: true } },
        },
      },
      groups: {
        select: {
          group: {
            select: {
              userGroups: {
                select: { user: { select: { id: true, name: true, email: true, image: true, isAgent: true } } },
              },
            },
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

/** 担当者の候補。所属ボードを持たせて、呼び出し側で対象ボードの絞り込みに使えるようにする */
export type AssigneeCandidate = {
  id: string
  name: string
  email: string
  image: string | null
  isAgent: boolean
  /** 引数で渡したボードのうち、そのユーザーがメンバーであるもの */
  boardIds: string[]
}

/**
 * 複数ボードのメンバー実体(直接メンバー ∪ グループ所属ユーザー)をユーザー単位に畳む。
 * ボード横断の担当者候補(チケット一覧の絞り込み)に使う。全ユーザー一覧は返さない。
 */
export const getBoardsMemberUsers = async (boardIds: string[], tx: Db = prisma): Promise<AssigneeCandidate[]> => {
  if (boardIds.length === 0) {
    return []
  }

  const userSelect = { id: true, name: true, email: true, image: true, isAgent: true } as const
  const boards = await tx.board.findMany({
    where: { id: { in: boardIds } },
    select: {
      id: true,
      members: { select: { user: { select: userSelect } } },
      groups: { select: { group: { select: { userGroups: { select: { user: { select: userSelect } } } } } } },
    },
  })

  const users = new Map<string, AssigneeCandidate>()
  const add = (boardId: string, user: Omit<AssigneeCandidate, 'boardIds'>) => {
    const found = users.get(user.id)
    if (!found) {
      users.set(user.id, { ...user, boardIds: [boardId] })
    } else if (!found.boardIds.includes(boardId)) {
      found.boardIds.push(boardId)
    }
  }

  for (const board of boards) {
    for (const { user } of board.members) {
      add(board.id, user)
    }
    for (const { group } of board.groups) {
      for (const { user } of group.userGroups) {
        add(board.id, user)
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

/**
 * ボード内のチケット番号を 1 つ払い出す。
 *
 * `UPDATE ... RETURNING` の行ロックで同一ボードへの同時作成が直列化されるため番号は重複しない。
 * シーケンスと違い、トランザクションがロールバックすればカウンタも戻るので欠番も出ない。
 * ロックはコミットまで残るので、チケット作成の直前に呼ぶこと。
 */
export const nextTicketNumber = async (tx: Prisma.TransactionClient, boardId: string): Promise<number> => {
  const { ticketSeq } = await tx.board.update({
    where: { id: boardId },
    data: { ticketSeq: { increment: 1 } },
    select: { ticketSeq: true },
  })
  return ticketSeq
}

/**
 * 本文に貼られた添付を、本文の保存先ボードへ紐付け直す。
 *
 * アップロードは本文の保存より前に走るので、作成フォームでボードを選び直すと添付だけが
 * 前のボードに残り、保存先ボードのメンバーが `/api/upload/<キー>` を読めなくなる。
 * 付け替えは本人がアップロードしたものに限る(他人の添付を自分のボードへ引き込めないようにする)。
 * 保存先ボードへのアクセスは呼び出し元で `assertBoardAccess` を通していること。
 */
export const reassignContentAttachments = async (
  tx: Prisma.TransactionClient,
  content: string | null | undefined,
  boardId: string,
  actor: Actor,
): Promise<void> => {
  const keys = content ? extractUploadKeys(content) : []
  if (keys.length === 0) {
    return
  }
  await tx.attachment.updateMany({
    where: { key: { in: keys }, createdById: actor.id, boardId: { not: boardId } },
    data: { boardId },
  })
}

/**
 * 表示ID(`KEY-番号`)からチケット ID を引く。形式外・未存在・アクセス不可はいずれも null。
 *
 * アクセス不可を未存在と区別せずに潰すことで、短縮URLが「そのチケットが在るか」と
 * 内部 ID を答えてしまわないようにする。
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
  const access = await getBoardAccess(actor, board.id)
  if (!access) {
    return null
  }
  const ticket = await prisma.ticket.findUnique({
    where: { boardId_number: { boardId: board.id, number: parsed.number } },
    select: { id: true },
  })
  return ticket?.id ?? null
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

/**
 * メンション候補。そのボードの直接メンバー ∪ グループ所属ユーザー。
 * プライベートボードではメンバーが本人 1 人なので、自然に本人のみになる。
 */
export const getBoardMentionCandidates = async (
  boardId: string,
  tx: Db = prisma,
): Promise<{ id: string; email: string }[]> => {
  const users = await getBoardMemberUsers(boardId, tx)
  return users.map(({ id, email }) => ({ id, email }))
}

/** {@link getBoardMentionCandidates} のチケット版(既にアクセス判定を済ませている経路用) */
export const getTicketMentionCandidates = async (
  access: TicketAccess,
  tx: Db = prisma,
): Promise<{ id: string; email: string }[]> => getBoardMentionCandidates(access.boardId, tx)

/**
 * コメントの返信先(parentId)が返信可能な相手かを検証する。NG なら errInvalidOperation() を throw。
 * スレッドは 1 階層のみ許容するため、返信先自体が既に返信(parentId を持つ)である場合は拒否する。
 * 投稿先チケットと親コメントの所属チケットが一致しない(他チケットのコメントIDを指定した)場合も拒否する。
 */
export const assertReplyTarget = async (tx: Db, ticketId: string, parentId: string): Promise<void> => {
  const parent = await tx.ticketComment.findUnique({
    where: { id: parentId },
    select: { ticketId: true, parentId: true },
  })
  if (!parent || parent.parentId || parent.ticketId !== ticketId) {
    throw errInvalidOperation()
  }
}

/**
 * チケットのステータス / レーン位置を更新するコア。
 * かんばんの DnD・カード内メニュー・詳細画面のステータス変更が共有する唯一の経路。
 *
 * `index` を省略すると移動先レーンの末尾へ入る。
 * レーン内は 0..n-1 の連番へ再採番する(行ごとに異なる値になるため updateMany では書けず、生 SQL で 1 文にまとめる)。
 *
 * 採番の対象は盤面に表示されるカードだけ。かんばんに出ない古い完了カードは読まず order も触らないので、
 * クライアントが送る index(盤面に見えているカードだけを数えた位置)とそのまま基準が揃う。
 */
export const moveTicketToLane = async (
  tx: Prisma.TransactionClient,
  { access, status, index }: { access: TicketAccess; status: TicketStatus; index?: number },
): Promise<{ id: string; status: TicketStatus; order: number }> => {
  // レーンは「同一ボード + 同一ステータス」で決まる
  const lane = await tx.ticket.findMany({
    where: kanbanLaneWhere(access.boardId, status, kanbanDoneSince(nowDate())),
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
  await tx.ticket.update({
    where: { id: access.ticketId },
    data: {
      status,
      order: movedOrder,
      // 同一レーン内の並べ替えでは完了日時を書き換えない
      ...(access.status !== status && { completedAt: status === 'done' ? nowDate() : null }),
    },
  })

  // MAX_KANBAN_CARDS(500)まで入りうるレーンで毎回全行を UPDATE しないよう、order が変わる行だけ触る
  const shifted = ordered.filter(({ id, order }) => id !== access.ticketId && currentOrder.get(id) !== order)
  if (shifted.length > 0) {
    /**
     * レーン先頭への移動では実質全行が対象になるため、1 行ずつではなく 1 文で更新する。
     * 生 SQL では `@updatedAt` が効かないので、1 行ずつ update していたときと同じになるよう明示的に触る。
     */
    await tx.$executeRaw`
      UPDATE "ticket" AS t
      SET "order" = v."order", "updatedAt" = NOW()
      FROM (VALUES ${Prisma.join(
        shifted.map(({ id, order }) => Prisma.sql`(${id}::text, ${order}::int)`),
      )}) AS v(id, "order")
      WHERE t.id = v.id
    `
  }

  return { id: access.ticketId, status, order: movedOrder }
}
