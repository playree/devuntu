/**
 * Wiki ページの階層の純粋関数(wiki-tree.ts)
 */

import {
  ancestorIds,
  depthOf,
  descendantIds,
  indexWikiTree,
  isSelfOrDescendant,
  placeInSiblings,
  subtreeHeight,
} from '@/lib/wiki/wiki-tree'
import { describe, expect, it } from 'vitest'

/**
 * a ─ b ─ c ─ d
 *   └ e
 * f
 */
const index = indexWikiTree([
  { id: 'a', parentId: null },
  { id: 'b', parentId: 'a' },
  { id: 'c', parentId: 'b' },
  { id: 'd', parentId: 'c' },
  { id: 'e', parentId: 'a' },
  { id: 'f', parentId: null },
])

describe('ancestorIds / depthOf', () => {
  it('先祖を近い順に返し、深さはスペース直下を 1 とする', () => {
    expect(ancestorIds(index, 'd')).toEqual(['c', 'b', 'a'])
    expect(depthOf(index, 'd')).toBe(4)
    expect(depthOf(index, 'f')).toBe(1)
  })

  it('壊れた木(循環)でも止まる', () => {
    const broken = indexWikiTree([
      { id: 'x', parentId: 'y' },
      { id: 'y', parentId: 'x' },
    ])
    expect(ancestorIds(broken, 'x')).toEqual(['y'])
  })
})

describe('descendantIds / subtreeHeight', () => {
  it('子孫を幅優先で返す', () => {
    expect(descendantIds(index, 'a')).toEqual(['b', 'e', 'c', 'd'])
    expect(descendantIds(index, 'f')).toEqual([])
  })

  it('部分木の高さは子が無ければ 1', () => {
    expect(subtreeHeight(index, 'a')).toBe(4)
    expect(subtreeHeight(index, 'c')).toBe(2)
    expect(subtreeHeight(index, 'e')).toBe(1)
  })
})

describe('isSelfOrDescendant', () => {
  it('自分自身と子孫は true(移動先の親にすると循環する)', () => {
    expect(isSelfOrDescendant(index, 'b', 'b')).toBe(true)
    expect(isSelfOrDescendant(index, 'b', 'd')).toBe(true)
    expect(isSelfOrDescendant(index, 'b', 'a')).toBe(false)
    expect(isSelfOrDescendant(index, 'b', 'e')).toBe(false)
  })
})

describe('placeInSiblings', () => {
  it('位置を省略すると末尾に入れる', () => {
    expect(placeInSiblings(['a', 'b'], 'x')).toEqual(['a', 'b', 'x'])
  })

  it('指定した位置に入れ、範囲外は端に寄せる', () => {
    expect(placeInSiblings(['a', 'b'], 'x', 1)).toEqual(['a', 'x', 'b'])
    expect(placeInSiblings(['a', 'b'], 'x', 99)).toEqual(['a', 'b', 'x'])
    expect(placeInSiblings(['a', 'b'], 'x', -1)).toEqual(['x', 'a', 'b'])
  })

  it('既に兄弟にいれば一度外してから入れる(並べ替え)', () => {
    expect(placeInSiblings(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a'])
    expect(placeInSiblings(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b'])
  })
})
