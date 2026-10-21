/** ボードノートの書き込みの可否と、MCP の応答に載せる索引 */

import { BoardNoteKind } from '@/generated/prisma/enums'
import {
  BOARD_NOTE_KINDS,
  BOARD_NOTE_NAME_PATTERN,
  buildBoardNoteIndex,
  knowledgeDenial,
  MCP_MEMORY_INDEX_LIMIT,
  touchesKnowledge,
} from '@/lib/board-note/board-note-rule'
import { describe, expect, it } from 'vitest'

describe('区分', () => {
  it('Prisma の enum と一致する', () => {
    expect([...BOARD_NOTE_KINDS].sort()).toEqual(Object.values(BoardNoteKind).sort())
  })
})

describe('BOARD_NOTE_NAME_PATTERN', () => {
  it.each(['deploy-steps', 'a', 'v2-api'])('kebab-case を通す (%s)', (name) => {
    expect(BOARD_NOTE_NAME_PATTERN.test(name)).toBe(true)
  })

  it.each(['Deploy', 'deploy_steps', '-deploy', 'deploy-', 'deploy--steps', 'デプロイ', 'a b'])(
    'kebab-case 以外は弾く (%s)',
    (name) => {
      expect(BOARD_NOTE_NAME_PATTERN.test(name)).toBe(false)
    },
  )
})

describe('knowledgeDenial', () => {
  it('画面からは常にナレッジを変えられる', () => {
    expect(knowledgeDenial({ via: 'web' })).toBeNull()
  })

  it('MCP の人の経路は同意の申告があるときだけ変えられる', () => {
    expect(knowledgeDenial({ via: 'mcp', agent: false, userApproved: true })).toBeNull()
    expect(knowledgeDenial({ via: 'mcp', agent: false, userApproved: false })).toBe('approval')
  })

  it('エージェント経路は申告があっても変えられない(ユーザーが不在のため)', () => {
    expect(knowledgeDenial({ via: 'mcp', agent: true, userApproved: true })).toBe('agent')
  })
})

describe('touchesKnowledge', () => {
  it('ナレッジの作成・更新・削除と、昇格・降格が対象', () => {
    expect(touchesKnowledge(null, 'knowledge')).toBe(true)
    expect(touchesKnowledge('knowledge', 'knowledge')).toBe(true)
    expect(touchesKnowledge('knowledge', null)).toBe(true)
    expect(touchesKnowledge('memory', 'knowledge')).toBe(true)
    expect(touchesKnowledge('knowledge', 'memory')).toBe(true)
  })

  it('メモリだけの変更は対象外', () => {
    expect(touchesKnowledge(null, 'memory')).toBe(false)
    expect(touchesKnowledge('memory', 'memory')).toBe(false)
    expect(touchesKnowledge('memory', null)).toBe(false)
  })
})

describe('buildBoardNoteIndex', () => {
  const note = (name: string) => ({ name, description: `${name} の説明` })

  it('"name: description" の文字列で返す', () => {
    expect(buildBoardNoteIndex([note('a')], [note('b')], 1)).toEqual({
      boardKnowledge: ['a: a の説明'],
      boardMemory: ['b: b の説明'],
    })
  })

  it('0 件の区分は項目ごと省く', () => {
    expect(buildBoardNoteIndex([], [], 0)).toEqual({})
  })

  it('メモリは上限で切り、載せきれなかった件数を返す', () => {
    const memory = Array.from({ length: MCP_MEMORY_INDEX_LIMIT + 5 }, (_, i) => note(`m${i}`))
    const index = buildBoardNoteIndex([], memory, MCP_MEMORY_INDEX_LIMIT + 12)
    expect(index.boardMemory).toHaveLength(MCP_MEMORY_INDEX_LIMIT)
    expect(index.boardMemory?.[0]).toBe('m0: m0 の説明')
    expect(index.boardMemoryOmitted).toBe(12)
  })
})
