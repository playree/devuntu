/**
 * ボードのメンバー実体(直接メンバー ∪ グループ所属ユーザー)の参照と、アサインの検証(サーバー専用)
 */

import { Prisma } from '@/generated/prisma/client'
import { errInvalidOperation } from '../error'
import { mergeMemberUsers } from '../group'
import { prisma, type Db } from '../prisma'
import type { TicketAccess } from './board-access'
import { type BoardRole } from './ticket-permission'

/** ボードのメンバーとして返すユーザーの列。担当者・メンション候補・メンバー設定で共有する */
export const BOARD_USER_SELECT = { id: true, name: true, email: true, image: true, isAgent: true } as const

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
          user: { select: BOARD_USER_SELECT },
        },
      },
      groups: {
        select: {
          group: {
            select: {
              userGroups: {
                select: { user: { select: BOARD_USER_SELECT } },
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

  return mergeMemberUsers<BoardUser>(
    board.members.map(({ role, user }) => ({ ...user, role, via: 'member' })),
    board.groups.flatMap(({ group }) => group.userGroups.map(({ user }) => ({ ...user, role: null, via: 'group' }))),
  )
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

  const boards = await tx.board.findMany({
    where: { id: { in: boardIds } },
    select: {
      id: true,
      members: { select: { user: { select: BOARD_USER_SELECT } } },
      groups: { select: { group: { select: { userGroups: { select: { user: { select: BOARD_USER_SELECT } } } } } } },
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
