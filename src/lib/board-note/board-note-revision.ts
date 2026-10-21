/**
 * ボードノートの版(サーバー専用)
 *
 * 書き込みと同じトランザクションで版を残し、1件あたりの上限(BOARD_NOTE_REVISION_MAX_PER_NOTE)を超えた分を消す。
 * 保持期間を過ぎた版は自動メンテナンス(`sweepBoardNoteRevisions`)で消す。
 */

import type { Prisma } from '@/generated/prisma/client'
import type { BoardNoteKind, BoardNoteRevisionAction, BoardNoteVia } from '@/generated/prisma/enums'
import { assertBoardAccess, type Actor } from '../board/board-access'
import { ticketDisplayId } from '../board/ticket-id'
import { envu } from '../env-util'
import { errInvalidOperation } from '../error'
import { prisma, type Db } from '../prisma'
import type { BoardNoteSnapshot } from './board-note-rule'

export type WriteBoardNoteRevision = {
  noteId: string
  boardId: string
  action: BoardNoteRevisionAction
  snapshot: BoardNoteSnapshot
  actorId: string
  via: BoardNoteVia
  ticketId?: string | null
  restoredFromId?: string | null
}

export const writeBoardNoteRevision = async (tx: Db, { snapshot, ...revision }: WriteBoardNoteRevision) => {
  await tx.boardNoteRevision.create({ data: { ...revision, ...snapshot } })
  const excess = await tx.boardNoteRevision.findMany({
    where: { noteId: revision.noteId },
    select: { id: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: envu.server.BOARD_NOTE_REVISION_MAX_PER_NOTE,
  })
  if (excess.length > 0) {
    await tx.boardNoteRevision.deleteMany({ where: { id: { in: excess.map(({ id }) => id) } } })
  }
}

const REVISION_SELECT = {
  id: true,
  noteId: true,
  action: true,
  kind: true,
  type: true,
  name: true,
  description: true,
  content: true,
  via: true,
  createdAt: true,
  actor: { select: { name: true, isAgent: true } },
  ticket: { select: { number: true, board: { select: { key: true } } } },
} as const

export type BoardNoteRevisionItem = BoardNoteSnapshot & {
  id: string
  noteId: string
  action: BoardNoteRevisionAction
  via: BoardNoteVia
  createdAt: Date
  actorName: string
  actorIsAgent: boolean
  /** 書いたときに対応していたチケットの表示ID */
  ticketDisplayId: string | null
}

const toRevisionItem = ({
  ticket,
  actor,
  ...row
}: Prisma.BoardNoteRevisionGetPayload<{ select: typeof REVISION_SELECT }>): BoardNoteRevisionItem => ({
  ...row,
  actorName: actor?.name ?? '',
  actorIsAgent: actor?.isAgent ?? false,
  ticketDisplayId: ticket ? ticketDisplayId({ key: ticket.board.key, number: ticket.number }) : null,
})

/** ノートの版の一覧(新しい順)。削除済みのノートの版も引ける */
export const listBoardNoteRevisions = async (actor: Actor, noteId: string): Promise<BoardNoteRevisionItem[]> => {
  const owner =
    (await prisma.boardNote.findUnique({ where: { id: noteId }, select: { boardId: true } })) ??
    (await prisma.boardNoteRevision.findFirst({ where: { noteId }, select: { boardId: true } }))
  if (!owner) {
    throw errInvalidOperation()
  }
  await assertBoardAccess(actor, owner.boardId, 'view')
  const rows = await prisma.boardNoteRevision.findMany({
    where: { noteId },
    select: REVISION_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
  return rows.map(toRevisionItem)
}

/** 削除済みのノート(最後の版が削除で、いまは存在しないもの)。復元はその版から行う */
export const listDeletedBoardNotes = async (
  actor: Actor,
  boardId: string,
  kind: BoardNoteKind,
): Promise<BoardNoteRevisionItem[]> => {
  await assertBoardAccess(actor, boardId, 'view')
  const rows = await prisma.boardNoteRevision.findMany({
    where: { boardId, kind, action: 'deleted' },
    select: REVISION_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    distinct: ['noteId'],
  })
  if (rows.length === 0) {
    return []
  }
  const alive = await prisma.boardNote.findMany({
    where: { id: { in: rows.map(({ noteId }) => noteId) } },
    select: { id: true },
  })
  const aliveIds = new Set(alive.map(({ id }) => id))
  return rows.filter(({ noteId }) => !aliveIds.has(noteId)).map(toRevisionItem)
}
