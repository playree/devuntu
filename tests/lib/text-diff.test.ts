/** 履歴の表示に使う行単位の差分 */

import { diffLines, foldDiffLines } from '@/lib/text-diff'
import { describe, expect, it } from 'vitest'

describe('diffLines', () => {
  it('同じ内容なら全行が一致になる', () => {
    expect(diffLines('a\nb', 'a\nb')).toEqual([
      { op: 'same', text: 'a' },
      { op: 'same', text: 'b' },
    ])
  })

  it('行の追加・削除・置き換えを出す', () => {
    expect(diffLines('a\nb\nc\nd', 'a\nx\nc\nd\ne')).toEqual([
      { op: 'same', text: 'a' },
      { op: 'del', text: 'b' },
      { op: 'add', text: 'x' },
      { op: 'same', text: 'c' },
      { op: 'same', text: 'd' },
      { op: 'add', text: 'e' },
    ])
  })

  it('中ほどの一致行は LCS で残す', () => {
    expect(diffLines('a\nb\nc', 'b\nc\nd').map(({ op }) => op)).toEqual(['del', 'same', 'same', 'add'])
  })

  it('大きすぎる差分は全削除 + 全追加に倒す', () => {
    const before = Array.from({ length: 600 }, (_, i) => `b${i}`).join('\n')
    const after = Array.from({ length: 600 }, (_, i) => `a${i}`).join('\n')
    const lines = diffLines(before, after)
    expect(lines.slice(0, 600).every(({ op }) => op === 'del')).toBe(true)
    expect(lines.slice(600).every(({ op }) => op === 'add')).toBe(true)
  })
})

describe('foldDiffLines', () => {
  it('変更から離れた一致行を件数にまとめる', () => {
    const lines = diffLines(
      ['1', '2', '3', '4', '5', '6', '7'].join('\n'),
      ['1', '2', '3', '4', '5', '6', 'x'].join('\n'),
    )
    expect(foldDiffLines(lines, 1)).toEqual([
      { op: 'skip', count: 5 },
      { op: 'same', text: '6' },
      { op: 'del', text: '7' },
      { op: 'add', text: 'x' },
    ])
  })

  it('変更が無ければ全体を1つにまとめる', () => {
    expect(foldDiffLines(diffLines('a\nb', 'a\nb'))).toEqual([{ op: 'skip', count: 2 }])
  })
})
