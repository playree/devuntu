/**
 * MCP のボード参照(サーバー専用)
 *
 * チケットを作るには boardId / assigneeId / tagIds の3種のIDが要るが、MCP から引く口が無いと
 * 利用者が UUID を手で渡すしかない。`list_boards` でボードを特定し、`get_board` で担当者候補と
 * タグを引けるようにして、MCP だけで作成まで辿り着けるようにする。
 *
 * 権限判定は画面と同じ関数(assertBoardAccess / listAccessibleBoards)へそのまま委ねること。
 */

import { assertBoardAccess, countTicketsByBoard, getBoardMemberUsers, listAccessibleBoards } from '@/lib/board/board'
import { listBoardTags } from '@/lib/board/tag'
import { BOARD_KEY_PATTERN } from '@/lib/board/task'
import { errInvalidOperation } from '@/lib/error'
import type { ResourceAuth } from '@/lib/oauth/oauth-resource'
import { prisma } from '@/lib/prisma'

/**
 * ボードID でもボードキー(例: ABC)でも受け取れるようにする。`resolveTicketId` と同じ役割。
 *
 * キーは全ボード一意で、UUIDv7 は BOARD_KEY_PATTERN(大文字英数)に一致しないため取り違えない。
 * 存在の有無を漏らさないよう、ここでは認可を見ない(呼び出し側の assertBoardAccess /
 * buildTicketWhere が可視スコープで弾く)。
 */
export const resolveBoardId = async (boardIdOrKey: string): Promise<string> => {
  if (!BOARD_KEY_PATTERN.test(boardIdOrKey)) {
    return boardIdOrKey
  }
  const board = await prisma.board.findUnique({ where: { key: boardIdOrKey }, select: { id: true } })
  if (!board) {
    throw errInvalidOperation()
  }
  return board.id
}

export const listBoardsForMcp = async (auth: ResourceAuth, opts?: { includeArchived?: boolean }) => {
  const boards = await listAccessibleBoards(auth.user.id, { includeArchived: opts?.includeArchived })
  return boards.map((board) => ({
    id: board.id,
    key: board.key,
    name: board.name,
    description: board.description,
    kind: board.kind,
    archived: board.archived,
    role: board.role,
    via: board.via,
  }))
}

export const getBoardForMcp = async (auth: ResourceAuth, boardIdOrKey: string) => {
  const id = await resolveBoardId(boardIdOrKey)
  const access = await assertBoardAccess(auth.user, id, 'view')

  const board = await prisma.board.findUnique({
    where: { id },
    select: { key: true, name: true, description: true },
  })
  if (!board) {
    throw errInvalidOperation()
  }

  const [members, tags, counts] = await Promise.all([
    getBoardMemberUsers(id),
    listBoardTags(id),
    countTicketsByBoard([id]),
  ])

  return {
    id,
    key: board.key,
    name: board.name,
    description: board.description ?? '',
    kind: access.kind,
    archived: access.archived,
    role: access.role,
    /** チケットの担当者(assigneeId)とメンション(@[アドレス])の宛先に指定できる面々 */
    members: members.map(({ id, name, email, isAgent, role, via }) => ({ id, name, email, isAgent, role, via })),
    /** チケットの tagIds に指定できるタグ。他ボードのタグは付けられない */
    tags: tags.map(({ id, name, color }) => ({ id, name, color })),
    ticketCounts: counts[id] ?? {},
  }
}
