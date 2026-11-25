/**
 * 保存する項目の変更判定(wiki-rule.ts の isWikiPageChanged)
 */

import { isWikiPageChanged, type WikiPageFields } from '@/lib/wiki/wiki-rule'
import { describe, expect, it } from 'vitest'

const base: WikiPageFields = { title: 'タイトル', content: '# 本文', type: 'page', tagIds: ['a', 'b'] }

describe('isWikiPageChanged', () => {
  it('同じ内容なら変更なし', () => {
    expect(isWikiPageChanged(base, { ...base, tagIds: [...base.tagIds] })).toBe(false)
  })

  it('タグの並びだけが違うなら変更なし', () => {
    expect(isWikiPageChanged(base, { ...base, tagIds: ['b', 'a'] })).toBe(false)
  })

  it.each([
    ['タイトル', { title: 'タイトル2' }],
    ['本文', { content: '# 本文\n追記' }],
    ['種類', { type: 'design_doc' as const }],
    ['タグの追加', { tagIds: ['a', 'b', 'c'] }],
    ['タグの削除', { tagIds: ['a'] }],
    ['タグの入れ替え', { tagIds: ['a', 'c'] }],
  ])('%sが変われば変更あり', (_, patch) => {
    expect(isWikiPageChanged(base, { ...base, ...patch })).toBe(true)
  })
})
