/**
 * プライベートボードの用意と、ボード一覧・件数の参照(サーバー専用)
 *
 * 認可判定は `board-access.ts`、メンバーは `board-member.ts`、キーは `board-key.ts` を参照。
 */

import type { BoardKind, TicketStatus } from '@/generated/prisma/enums'
import { isUniqueViolation, prisma } from '../prisma'
import { nextPrivateBoardKey } from './board-key'
import { PRIVATE_BOARD_NAME } from './ticket-id'
import { resolveBoardRole, type BoardRole } from './ticket-permission'

/** ensurePrivateBoard のキー競合によるリトライ回数。キーの取り合いは同時実行数ぶんしか起きない */
const PRIVATE_BOARD_CREATE_RETRY = 3

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
