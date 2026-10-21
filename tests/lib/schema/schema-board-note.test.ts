/** ボードノートの入力スキーマ */

import { MAX_BOARD_NOTE_CONTENT } from '@/lib/board-note/board-note-rule'
import { scBoardNoteFields, zBoardNoteDescription, zBoardNoteName } from '@/lib/schema/schema-board-note'
import { describe, expect, it } from 'vitest'

const fields = (override: Record<string, unknown> = {}) => ({
  kind: 'memory',
  type: 'insight',
  name: 'deploy-steps',
  description: '本番デプロイの順序',
  content: '本文',
  ...override,
})

describe('zBoardNoteName', () => {
  it('前後の空白を落としてから kebab-case を見る', () => {
    expect(zBoardNoteName.parse(' deploy-steps ')).toBe('deploy-steps')
    expect(zBoardNoteName.safeParse('Deploy Steps').success).toBe(false)
  })
})

describe('zBoardNoteDescription', () => {
  it('索引に1行で載せるので改行を許さない', () => {
    expect(zBoardNoteDescription.safeParse('1行目\n2行目').success).toBe(false)
    expect(zBoardNoteDescription.safeParse('1行').success).toBe(true)
  })
})

describe('scBoardNoteFields', () => {
  it('本文の上限は区分ごとに見る', () => {
    const long = 'x'.repeat(MAX_BOARD_NOTE_CONTENT.memory + 1)
    expect(scBoardNoteFields.safeParse(fields({ content: long })).success).toBe(false)
    expect(scBoardNoteFields.safeParse(fields({ kind: 'knowledge', content: long })).success).toBe(true)
  })

  it('本文は必須', () => {
    expect(scBoardNoteFields.safeParse(fields({ content: '' })).success).toBe(false)
  })
})
