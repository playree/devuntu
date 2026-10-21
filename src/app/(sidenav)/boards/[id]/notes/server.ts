'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import {
  createBoardNote as createBoardNoteCore,
  deleteBoardNote as deleteBoardNoteCore,
  getBoardNote as getBoardNoteCore,
  getBoardNotePage,
  restoreBoardNoteRevision as restoreBoardNoteRevisionCore,
  updateBoardNote as updateBoardNoteCore,
} from '@/lib/board-note/board-note'
import { listBoardNoteRevisions, listDeletedBoardNotes } from '@/lib/board-note/board-note-revision'
import { scUUID } from '@/lib/schema/schema'
import {
  scBoardNoteListQuery,
  scCreateBoardNote,
  scUpdateBoardNote,
  zBoardNoteKind,
} from '@/lib/schema/schema-board-note'
import { z } from 'zod'

/**
 * ボードノート(メモリ / ナレッジ)画面の Server Action。
 * 処理本体と権限の検証は `@/lib/board-note/board-note` にある。画面からの書き込みはナレッジも変えられる
 */

const WEB = { via: 'web' } as const

export const getBoardNotes = safeAuthAction
  .metadata({ actionName: 'getBoardNotes', role: 'user' })
  .inputSchema(scBoardNoteListQuery)
  .action(async ({ ctx: { user }, parsedInput: { boardId, ...query } }) => getBoardNotePage(user, boardId, query))
export type GetBoardNotesReturnType = Awaited<ReturnType<typeof getBoardNotes>>['data']

export const getBoardNote = safeAuthAction
  .metadata({ actionName: 'getBoardNote', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => getBoardNoteCore(user, id))
export type GetBoardNoteReturnType = Awaited<ReturnType<typeof getBoardNote>>['data']

export const createBoardNote = safeAuthAction
  .metadata({ actionName: 'createBoardNote', role: 'user' })
  .inputSchema(scCreateBoardNote)
  .action(async ({ ctx: { user }, parsedInput: { boardId, fields } }) =>
    createBoardNoteCore(user, WEB, boardId, fields),
  )

export const updateBoardNote = safeAuthAction
  .metadata({ actionName: 'updateBoardNote', role: 'user' })
  .inputSchema(scUpdateBoardNote)
  .action(async ({ ctx: { user }, parsedInput: { id, baseUpdatedAt, fields } }) =>
    updateBoardNoteCore(user, WEB, id, fields, { expectedUpdatedAt: baseUpdatedAt }),
  )

/** 昇格(メモリ → ナレッジ)/ 降格。区分だけを変える */
export const moveBoardNote = safeAuthAction
  .metadata({ actionName: 'moveBoardNote', role: 'user' })
  .inputSchema(z.object({ id: z.uuidv7(), kind: zBoardNoteKind }))
  .action(async ({ ctx: { user }, parsedInput: { id, kind } }) => updateBoardNoteCore(user, WEB, id, { kind }))

export const deleteBoardNote = safeAuthAction
  .metadata({ actionName: 'deleteBoardNote', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => {
    await deleteBoardNoteCore(user, WEB, id)
    return { id }
  })

/** ノートの版の一覧(削除済みのノートも引ける) */
export const getBoardNoteRevisions = safeAuthAction
  .metadata({ actionName: 'getBoardNoteRevisions', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => listBoardNoteRevisions(user, id))
export type GetBoardNoteRevisionsReturnType = Awaited<ReturnType<typeof getBoardNoteRevisions>>['data']

export const getDeletedBoardNotes = safeAuthAction
  .metadata({ actionName: 'getDeletedBoardNotes', role: 'user' })
  .inputSchema(z.object({ boardId: z.uuidv7(), kind: zBoardNoteKind }))
  .action(async ({ ctx: { user }, parsedInput: { boardId, kind } }) => listDeletedBoardNotes(user, boardId, kind))

/** 版の内容へ戻す。削除済みのノートは削除時の版から作り直す */
export const restoreBoardNoteRevision = safeAuthAction
  .metadata({ actionName: 'restoreBoardNoteRevision', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => restoreBoardNoteRevisionCore(user, id))
