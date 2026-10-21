/**
 * ボードノート(メモリ / ナレッジ)の入力スキーマ
 */

import { el } from '@/locale'
import { z } from 'zod'
import {
  BOARD_NOTE_KINDS,
  BOARD_NOTE_NAME_PATTERN,
  BOARD_NOTE_TYPES,
  MAX_BOARD_NOTE_CONTENT,
  MAX_BOARD_NOTE_DESCRIPTION,
  MAX_BOARD_NOTE_NAME,
} from '../board-note/board-note-rule'

export const zBoardNoteKind = z.enum(BOARD_NOTE_KINDS)
export const zBoardNoteType = z.enum(BOARD_NOTE_TYPES)

export const zBoardNoteName = z
  .string()
  .trim()
  .min(1, el('@required_field'))
  .max(MAX_BOARD_NOTE_NAME, el('@invalid_board_note_name'))
  .regex(BOARD_NOTE_NAME_PATTERN, el('@invalid_board_note_name'))

/** 索引に1行で載せるので改行を許さない */
export const zBoardNoteDescription = z
  .string()
  .trim()
  .min(1, el('@required_field'))
  .max(MAX_BOARD_NOTE_DESCRIPTION, el('@invalid_board_note_description'))
  .regex(/^[^\r\n]*$/, el('@invalid_board_note_description'))

/** 区分ごとの上限はスキーマを組む側(refine)とサーバー側で見る。ここでは大きい方で切る */
export const zBoardNoteContent = z
  .string()
  .min(1, el('@required_field'))
  .max(Math.max(...Object.values(MAX_BOARD_NOTE_CONTENT)), el('@invalid_content'))

/** 画面の編集フォーム */
export const scBoardNoteFields = z
  .object({
    kind: zBoardNoteKind,
    type: zBoardNoteType,
    name: zBoardNoteName,
    description: zBoardNoteDescription,
    content: zBoardNoteContent,
  })
  .refine(({ kind, content }) => content.length <= MAX_BOARD_NOTE_CONTENT[kind], {
    path: ['content'],
    message: el('@invalid_content'),
  })
export type BoardNoteFields = z.infer<typeof scBoardNoteFields>

export const scCreateBoardNote = z.object({ boardId: z.uuidv7(), fields: scBoardNoteFields })
export type CreateBoardNote = z.infer<typeof scCreateBoardNote>

/** `baseUpdatedAt` は編集を開いた時点の更新日時。他の人が先に保存していれば競合として弾く */
export const scUpdateBoardNote = z.object({
  id: z.uuidv7(),
  baseUpdatedAt: z.iso.datetime(),
  fields: scBoardNoteFields,
})
export type UpdateBoardNote = z.infer<typeof scUpdateBoardNote>

/** 画面の一覧。区分はタブで切り替えるのでクライアントで分け、キーワードは本文も見るのでサーバーで絞る */
export const scBoardNoteListQuery = z.object({
  boardId: z.uuidv7(),
  keyword: z.string().max(100).default(''),
})
