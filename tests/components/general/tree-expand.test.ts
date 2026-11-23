/**
 * ツリーで選んだ項目を見せるために開く項目(tree-expand.ts)
 */

import { treeIdsToExpand } from '@/components/general/tree-expand'
import { describe, expect, it } from 'vitest'

const tree = (entries: [string, string | null][]) => new Map(entries.map(([id, parentId]) => [id, { parentId }]))

describe('treeIdsToExpand', () => {
  const byId = tree([
    ['root', null],
    ['child', 'root'],
    ['grandchild', 'child'],
    ['other', null],
  ])

  it('先祖を近い順に返し、withSelf なら自分を先頭に足す', () => {
    expect(treeIdsToExpand(byId, 'grandchild', false)).toEqual(['child', 'root'])
    expect(treeIdsToExpand(byId, 'grandchild', true)).toEqual(['grandchild', 'child', 'root'])
  })

  it('ルート直下は withSelf のときだけ自分を返す', () => {
    expect(treeIdsToExpand(byId, 'root', false)).toEqual([])
    expect(treeIdsToExpand(byId, 'root', true)).toEqual(['root'])
  })

  it('未選択なら何も開かない', () => {
    expect(treeIdsToExpand(byId, null, true)).toEqual([])
    expect(treeIdsToExpand(byId, undefined, true)).toEqual([])
  })

  it('項目に無い選択は、withSelf なら自分だけを返す', () => {
    expect(treeIdsToExpand(new Map(), 'later', true)).toEqual(['later'])
    expect(treeIdsToExpand(new Map(), 'later', false)).toEqual([])
  })

  it('親を辿って循環したら止める', () => {
    const cyclic = tree([
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'a'],
    ])
    expect(treeIdsToExpand(cyclic, 'a', true)).toEqual(['a', 'b', 'c'])
    expect(treeIdsToExpand(cyclic, 'a', false)).toEqual(['b', 'c'])
  })
})
