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

// 削除済みの一覧は名前と説明だけを出すので、本文は履歴を開いたときにだけ引く
const REVISION_SUMMARY_SELECT = {
  id: true,
  noteId: true,
  action: true,
  kind: true,
  name: true,
  description: true,
  via: true,
  createdAt: true,
  actor: { select: { name: true, isAgent: true } },
  ticket: { select: { number: true, board: { select: { key: true } } } },
} as const

const REVISION_SELECT = { ...REVISION_SUMMARY_SELECT, content: true } as const

export type BoardNoteRevisionSummary = Omit<BoardNoteRevisionItem, 'content'>

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

const toRevisionItem = <T extends Prisma.BoardNoteRevisionGetPayload<{ select: typeof REVISION_SUMMARY_SELECT }>>({
  ticket,
  actor,
  ...row
}: T) => ({
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
  return rows.map((row): BoardNoteRevisionItem => toRevisionItem(row))
}

/**
 * 削除済みのノート(いまは存在しないもの)を、最後に削除された版で返す。復元はその版から行う。
 * 区分は削除と復元・昇格をまたいで変わりうるので、ノートごとに最後の削除を選んでから区分で絞る
 */
export const listDeletedBoardNotes = async (
  actor: Actor,
  boardId: string,
  kind: BoardNoteKind,
): Promise<BoardNoteRevisionSummary[]> => {
  await assertBoardAccess(actor, boardId, 'view')
  const rows = await prisma.boardNoteRevision.findMany({
    where: { boardId, action: 'deleted' },
    select: REVISION_SUMMARY_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    distinct: ['noteId'],
  })
  const deleted = rows.filter((row) => row.kind === kind)
  if (deleted.length === 0) {
    return []
  }
  const alive = await prisma.boardNote.findMany({
    where: { id: { in: deleted.map(({ noteId }) => noteId) } },
    select: { id: true },
  })
  const aliveIds = new Set(alive.map(({ id }) => id))
  return deleted.filter(({ noteId }) => !aliveIds.has(noteId)).map(toRevisionItem)
}
