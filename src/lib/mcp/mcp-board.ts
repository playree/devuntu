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
 * 認可はここでは見ない(呼び出し側の assertBoardAccess / buildTicketWhere が可視スコープで弾く)。
 *
 * `allowUnknownKey` は絞り込み条件としてキーを受ける経路向け。既定では未知キーをエラーにするが、
 * 「エラー = 存在しない / 0 件 = 存在するがアクセス外」という応答差でボードの存在を
 * 推測できてしまう経路では、未知キーも解決せずに返してアクセス外と同じ結果へ寄せる。
 */
export const resolveBoardId = async (boardIdOrKey: string, opts?: { allowUnknownKey?: boolean }): Promise<string> => {
  if (!BOARD_KEY_PATTERN.test(boardIdOrKey)) {
    return boardIdOrKey
  }
  const board = await prisma.board.findUnique({ where: { key: boardIdOrKey }, select: { id: true } })
  if (!board) {
    if (opts?.allowUnknownKey) {
      // 未解決のキーは可視ボードのどのIDとも一致しないため、呼び出し側で 0 件になる
      return boardIdOrKey
    }
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
