/**
 * ボードノート(メモリ / ナレッジ)の参照・更新(サーバー専用)
 *
 * 閲覧はボードのメンバー、書き込みはメンバー(アーカイブ済みのボードは不可)。
 * ナレッジの変更は経路で制限し(knowledgeDenial)、変更はすべて版として残す(board-note-revision.ts)。
 * 純粋関数と定数は `board-note-rule.ts` を参照。
 */

import type { BoardNoteKind, BoardNoteType } from '@/generated/prisma/enums'
import { assertBoardAccess, type Actor } from '../board/board-access'
import { splitKeywords } from '../board/ticket-search'
import { envu } from '../env-util'
import { ClientError, errInvalidOperation, errValidation } from '../error'
import { logger } from '../logger'
import { isUniqueViolation, prisma, type Db } from '../prisma'
import { writeBoardNoteRevision } from './board-note-revision'
import {
  BOARD_NOTE_CONFLICT,
  BOARD_NOTE_KNOWLEDGE_DENIED,
  BOARD_NOTE_LIMIT_REACHED,
  buildBoardNoteIndex,
  DUPLICATED_BOARD_NOTE_NAME,
  knowledgeDenial,
  MAX_BOARD_NOTE_CONTENT,
  MCP_MEMORY_INDEX_LIMIT,
  sameBoardNoteSnapshot,
  touchesKnowledge,
  type BoardNoteSnapshot,
  type BoardNoteWriter,
} from './board-note-rule'

/** 区分ごとの件数の上限(環境変数) */
export const boardNoteLimits = (): Record<BoardNoteKind, number> => ({
  knowledge: envu.server.BOARD_KNOWLEDGE_MAX_COUNT,
  memory: envu.server.BOARD_MEMORY_MAX_COUNT,
})

// MCP からも返すので、AI が次の手を選べるようメッセージに理由と対処を書く
const errDuplicatedName = () =>
  new ClientError(DUPLICATED_BOARD_NOTE_NAME, 'A note with this name already exists on the board. Update it instead')
const errLimitReached = (kind: BoardNoteKind, max: number) =>
  new ClientError(
    BOARD_NOTE_LIMIT_REACHED,
    `This board already has the maximum number of ${kind} notes (${max}). Update or delete an existing one instead`,
  )
/** 読んだ後に他の人が更新した・削除した(MCP は削除済みの名前への保存にも使う) */
export const errBoardNoteConflict = (message = 'The note was updated by someone else after you read it') =>
  new ClientError(BOARD_NOTE_CONFLICT, `${message}. Read it again and retry`)
const errKnowledgeDenied = (reason: 'agent' | 'approval') =>
  new ClientError(
    BOARD_NOTE_KNOWLEDGE_DENIED,
    reason === 'agent'
      ? 'Agents cannot change knowledge. Save it as memory, or propose the change to the user in your report'
      : 'Changing knowledge requires explicit user instruction or consent. Ask the user, then retry with userApproved=true',
  )

const rethrowDuplicatedName = (e: unknown): never => {
  if (isUniqueViolation(e)) {
    throw errDuplicatedName()
  }
  throw e
}

const assertKnowledgeAllowed = (writer: BoardNoteWriter, before: BoardNoteKind | null, after: BoardNoteKind | null) => {
  if (!touchesKnowledge(before, after)) {
    return
  }
  const denial = knowledgeDenial(writer)
  if (denial) {
    throw errKnowledgeDenied(denial)
  }
}

const assertContentLength = ({ kind, content }: Pick<BoardNoteSnapshot, 'kind' | 'content'>) => {
  if (content.length > MAX_BOARD_NOTE_CONTENT[kind]) {
    throw errValidation(`content of ${kind} must be at most ${MAX_BOARD_NOTE_CONTENT[kind]} characters`)
  }
}

/** ボード行をロックしてから件数を数え、同時作成で上限を超えないようにする */
const assertCapacity = async (tx: Db, boardId: string, kind: BoardNoteKind) => {
  await tx.$queryRaw`SELECT "id" FROM "board" WHERE "id" = ${boardId} FOR UPDATE`
  const max = boardNoteLimits()[kind]
  if ((await tx.boardNote.count({ where: { boardId, kind } })) >= max) {
    throw errLimitReached(kind, max)
  }
}

/** 版に紐づけるチケット。別ボードのチケットは紐づけない */
const resolveRevisionTicketId = async (tx: Db, boardId: string, ticketId: string | null | undefined) => {
  if (!ticketId) {
    return null
  }
  const ticket = await tx.ticket.findFirst({ where: { id: ticketId, boardId }, select: { id: true } })
  if (!ticket) {
    throw errValidation('ticketId must be a ticket on the same board')
  }
  return ticket.id
}

const SNAPSHOT_SELECT = { kind: true, type: true, name: true, description: true, content: true } as const

const snapshotOf = ({ kind, type, name, description, content }: BoardNoteSnapshot): BoardNoteSnapshot => ({
  kind,
  type,
  name,
  description,
  content,
})

const NOTE_SUMMARY_SELECT = {
  id: true,
  kind: true,
  type: true,
  name: true,
  description: true,
  updatedAt: true,
  updatedVia: true,
  updatedBy: { select: { name: true, isAgent: true } },
} as const

const NOTE_DETAIL_SELECT = {
  ...NOTE_SUMMARY_SELECT,
  boardId: true,
  content: true,
  createdAt: true,
  createdBy: { select: { name: true } },
} as const

export type BoardNoteWriteResult = {
  result: 'created' | 'updated' | 'unchanged'
  id: string
  name: string
  updatedAt: Date
}

type WriteOpts = { ticketId?: string | null }

export const createBoardNote = async (
  actor: Actor,
  writer: BoardNoteWriter,
  boardId: string,
  fields: BoardNoteSnapshot,
  opts: WriteOpts = {},
): Promise<BoardNoteWriteResult> => {
  assertContentLength(fields)
  const note = await prisma
    .$transaction(async (tx) => {
      await assertBoardAccess(actor, boardId, 'write', tx)
      assertKnowledgeAllowed(writer, null, fields.kind)
      await assertCapacity(tx, boardId, fields.kind)
      const ticketId = await resolveRevisionTicketId(tx, boardId, opts.ticketId)
      const created = await tx.boardNote.create({
        data: { boardId, ...fields, createdById: actor.id, updatedById: actor.id, updatedVia: writer.via },
        select: { id: true, name: true, updatedAt: true },
      })
      await writeBoardNoteRevision(tx, {
        noteId: created.id,
        boardId,
        action: 'created',
        snapshot: fields,
        actorId: actor.id,
        via: writer.via,
        ticketId,
      })
      return created
    })
    .catch(rethrowDuplicatedName)

  logger.info({ userId: actor.id, boardId, id: note.id, kind: fields.kind, via: writer.via }, 'board note created')
  return { result: 'created', ...note }
}

/**
 * ノートの更新。`patch` の undefined の項目はそのまま残す。
 * `expectedUpdatedAt`(ISO 8601)を渡すと、読んだ後に他の人が更新していれば BOARD_NOTE_CONFLICT で弾く
 */
export const updateBoardNote = async (
  actor: Actor,
  writer: BoardNoteWriter,
  id: string,
  patch: Partial<BoardNoteSnapshot>,
  opts: WriteOpts & { expectedUpdatedAt?: string } = {},
): Promise<BoardNoteWriteResult> => {
  const outcome = await prisma
    .$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "board_note" WHERE "id" = ${id} FOR UPDATE`
      const existing = await tx.boardNote.findUnique({
        where: { id },
        select: { ...SNAPSHOT_SELECT, boardId: true, updatedAt: true },
      })
      if (!existing) {
        throw errInvalidOperation()
      }
      await assertBoardAccess(actor, existing.boardId, 'write', tx)
      if (opts.expectedUpdatedAt && new Date(opts.expectedUpdatedAt).getTime() !== existing.updatedAt.getTime()) {
        throw errBoardNoteConflict()
      }
      const before = snapshotOf(existing)
      const next: BoardNoteSnapshot = {
        kind: patch.kind ?? before.kind,
        type: patch.type ?? before.type,
        name: patch.name ?? before.name,
        description: patch.description ?? before.description,
        content: patch.content ?? before.content,
      }
      assertContentLength(next)
      assertKnowledgeAllowed(writer, before.kind, next.kind)
      if (sameBoardNoteSnapshot(before, next)) {
        return { result: 'unchanged' as const, id, name: before.name, updatedAt: existing.updatedAt }
      }
      if (next.kind !== before.kind) {
        await assertCapacity(tx, existing.boardId, next.kind)
      }
      const ticketId = await resolveRevisionTicketId(tx, existing.boardId, opts.ticketId)
      const updated = await tx.boardNote.update({
        where: { id },
        data: { ...next, updatedById: actor.id, updatedVia: writer.via },
        select: { id: true, name: true, updatedAt: true },
      })
      await writeBoardNoteRevision(tx, {
        noteId: id,
        boardId: existing.boardId,
        action: 'updated',
        snapshot: next,
        actorId: actor.id,
        via: writer.via,
        ticketId,
      })
      return { result: 'updated' as const, ...updated }
    })
    .catch(rethrowDuplicatedName)

  if (outcome.result === 'updated') {
    logger.info({ userId: actor.id, id, via: writer.via }, 'board note updated')
  }
  return outcome
}

export const deleteBoardNote = async (
  actor: Actor,
  writer: BoardNoteWriter,
  id: string,
  opts: WriteOpts = {},
): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "board_note" WHERE "id" = ${id} FOR UPDATE`
    const existing = await tx.boardNote.findUnique({ where: { id }, select: { ...SNAPSHOT_SELECT, boardId: true } })
    if (!existing) {
      throw errInvalidOperation()
    }
    await assertBoardAccess(actor, existing.boardId, 'write', tx)
    assertKnowledgeAllowed(writer, existing.kind, null)
    const ticketId = await resolveRevisionTicketId(tx, existing.boardId, opts.ticketId)
    await tx.boardNote.delete({ where: { id } })
    await writeBoardNoteRevision(tx, {
      noteId: id,
      boardId: existing.boardId,
      action: 'deleted',
      snapshot: snapshotOf(existing),
      actorId: actor.id,
      via: writer.via,
      ticketId,
    })
  })

  logger.info({ userId: actor.id, id, via: writer.via }, 'board note deleted')
}

/**
 * 版の内容へ戻す(画面のみ)。ノートが残っていれば上書きし、削除済みなら同じ id で作り直す。
 * 同じ名前のノートが別にあれば DUPLICATED_BOARD_NOTE_NAME
 */
export const restoreBoardNoteRevision = async (actor: Actor, revisionId: string): Promise<BoardNoteWriteResult> => {
  const outcome = await prisma
    .$transaction(async (tx) => {
      const revision = await tx.boardNoteRevision.findUnique({
        where: { id: revisionId },
        select: { ...SNAPSHOT_SELECT, noteId: true, boardId: true },
      })
      if (!revision) {
        throw errInvalidOperation()
      }
      await assertBoardAccess(actor, revision.boardId, 'write', tx)
      const { noteId, boardId } = revision
      const snapshot = snapshotOf(revision)

      await tx.$queryRaw`SELECT "id" FROM "board_note" WHERE "id" = ${noteId} FOR UPDATE`
      const existing = await tx.boardNote.findUnique({ where: { id: noteId }, select: SNAPSHOT_SELECT })
      if (existing && sameBoardNoteSnapshot(snapshotOf(existing), snapshot)) {
        const current = await tx.boardNote.findUniqueOrThrow({ where: { id: noteId }, select: { updatedAt: true } })
        return { result: 'unchanged' as const, id: noteId, name: snapshot.name, updatedAt: current.updatedAt }
      }
      if (!existing || existing.kind !== snapshot.kind) {
        await assertCapacity(tx, boardId, snapshot.kind)
      }
      const data = { ...snapshot, updatedById: actor.id, updatedVia: 'web' as const }
      const note = existing
        ? await tx.boardNote.update({ where: { id: noteId }, data, select: { id: true, name: true, updatedAt: true } })
        : await tx.boardNote.create({
            data: { id: noteId, boardId, ...data, createdById: actor.id },
            select: { id: true, name: true, updatedAt: true },
          })
      await writeBoardNoteRevision(tx, {
        noteId,
        boardId,
        action: 'restored',
        snapshot,
        actorId: actor.id,
        via: 'web',
        restoredFromId: revisionId,
      })
      return { result: existing ? ('updated' as const) : ('created' as const), ...note }
    })
    .catch(rethrowDuplicatedName)

  logger.info({ userId: actor.id, revisionId, id: outcome.id }, 'board note restored')
  return outcome
}

export type BoardNoteQuery = { kind?: BoardNoteKind; type?: BoardNoteType; keyword?: string }

/** キーワードは語ごとに AND、各語は名前・説明・本文のいずれかに含まれればよい */
const boardNoteWhere = (boardId: string, { kind, type, keyword }: BoardNoteQuery) => ({
  boardId,
  ...(kind ? { kind } : {}),
  ...(type ? { type } : {}),
  AND: splitKeywords(keyword ?? '').map((word) => ({
    OR: (['name', 'description', 'content'] as const).map((field) => ({
      [field]: { contains: word, mode: 'insensitive' as const },
    })),
  })),
})

const queryBoardNotes = (boardId: string, query: BoardNoteQuery) =>
  prisma.boardNote.findMany({
    where: boardNoteWhere(boardId, query),
    select: NOTE_SUMMARY_SELECT,
    orderBy: [{ kind: 'asc' }, { updatedAt: 'desc' }, { name: 'asc' }],
  })

/** ノートの一覧(本文なし)。ナレッジ → メモリの順、区分内は更新の新しい順 */
export const listBoardNotes = async (actor: Actor, boardId: string, query: BoardNoteQuery = {}) => {
  await assertBoardAccess(actor, boardId, 'view')
  return queryBoardNotes(boardId, query)
}

export type BoardNoteSummary = Awaited<ReturnType<typeof listBoardNotes>>[number]

/** 区分ごとの件数 */
export const countBoardNotes = async (boardId: string): Promise<Record<BoardNoteKind, number>> => {
  const groups = await prisma.boardNote.groupBy({ by: ['kind'], where: { boardId }, _count: { _all: true } })
  const counts: Record<BoardNoteKind, number> = { knowledge: 0, memory: 0 }
  for (const group of groups) {
    counts[group.kind] = group._count._all
  }
  return counts
}

/** 名前でノートを引く(本文あり)。見つからなかった名前は notFound に返す */
export const getBoardNotesByName = async (actor: Actor, boardId: string, names: string[]) => {
  await assertBoardAccess(actor, boardId, 'view')
  const notes = await prisma.boardNote.findMany({
    where: { boardId, name: { in: names } },
    select: NOTE_DETAIL_SELECT,
  })
  const found = new Set(notes.map(({ name }) => name))
  // 指定された順に並べる(AI が読む順を自分で決められるように)
  const order = new Map(names.map((name, i) => [name, i]))
  notes.sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0))
  return { notes, notFound: names.filter((name) => !found.has(name)) }
}

/** 名前からノートの id を引く(MCP の save / delete)。無ければ null */
export const findBoardNoteIdByName = async (boardId: string, name: string): Promise<string | null> =>
  (await prisma.boardNote.findUnique({ where: { boardId_name: { boardId, name } }, select: { id: true } }))?.id ?? null

/** id でノートを引く(画面の詳細) */
export const getBoardNote = async (actor: Actor, id: string) => {
  const note = await prisma.boardNote.findUnique({ where: { id }, select: NOTE_DETAIL_SELECT })
  if (!note) {
    throw errInvalidOperation()
  }
  await assertBoardAccess(actor, note.boardId, 'view')
  return note
}

export type BoardNoteDetail = Awaited<ReturnType<typeof getBoardNote>>

/**
 * MCP の応答に載せる索引。認可は呼び出し側で通すこと(boardContext と同じく、ボードのメンバーにだけ返す)
 */
export const findBoardNoteIndex = async (boardId: string) => {
  const [knowledge, memory] = await Promise.all([
    prisma.boardNote.findMany({
      where: { boardId, kind: 'knowledge' },
      select: { name: true, description: true },
      orderBy: { name: 'asc' },
    }),
    prisma.boardNote.findMany({
      where: { boardId, kind: 'memory' },
      select: { name: true, description: true },
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
      take: MCP_MEMORY_INDEX_LIMIT,
    }),
  ])
  const memoryTotal =
    memory.length < MCP_MEMORY_INDEX_LIMIT
      ? memory.length
      : await prisma.boardNote.count({ where: { boardId, kind: 'memory' } })
  return buildBoardNoteIndex(knowledge, memory, memoryTotal)
}

/** 画面の一覧。ボードの表示名・書き込み可否・区分ごとの件数と上限を添える */
export const getBoardNotePage = async (actor: Actor, boardId: string, query: BoardNoteQuery) => {
  const access = await assertBoardAccess(actor, boardId, 'view')
  const [board, notes, counts] = await Promise.all([
    prisma.board.findUniqueOrThrow({ where: { id: boardId }, select: { id: true, name: true, kind: true } }),
    queryBoardNotes(boardId, query),
    countBoardNotes(boardId),
  ])
  return { board, canWrite: !access.archived, archived: access.archived, notes, counts, limits: boardNoteLimits() }
}
