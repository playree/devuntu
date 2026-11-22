/**
 * Wiki ページの階層の純粋関数(wiki-tree.ts)
 */

import {
  ancestorIds,
  arrangeDeletedWikiPages,
  depthOf,
  descendantIds,
  indexWikiTree,
  isSelfOrDescendant,
  nestWikiTree,
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

describe('nestWikiTree', () => {
  const rows = [
    { id: 'a', parentId: null, title: 'A' },
    { id: 'b', parentId: 'a', title: 'B' },
    { id: 'c', parentId: 'b', title: 'C' },
    { id: 'd', parentId: 'c', title: 'D' },
    { id: 'e', parentId: 'a', title: 'E' },
    { id: 'f', parentId: null, title: 'F' },
  ]
  const toNode = ({ title }: { title: string }) => ({ title })

  it('スペース直下から兄弟の並び順のまま入れ子にし、子の無い節には children を付けない', () => {
    expect(nestWikiTree(rows, toNode, { rootId: null })).toEqual([
      {
        title: 'A',
        children: [{ title: 'B', children: [{ title: 'C', children: [{ title: 'D' }] }] }, { title: 'E' }],
      },
      { title: 'F' },
    ])
  })

  it('depth より深い子は childCount だけを返す', () => {
    expect(nestWikiTree(rows, toNode, { rootId: null, depth: 2 })).toEqual([
      { title: 'A', children: [{ title: 'B', childCount: 1 }, { title: 'E' }] },
      { title: 'F' },
    ])
  })

  it('rootId の子孫だけを返し、rootId 自身は含めない', () => {
    expect(nestWikiTree(rows, toNode, { rootId: 'b', depth: 1 })).toEqual([{ title: 'C', childCount: 1 }])
  })

  it('循環した木でも止まる', () => {
    const broken = [
      { id: 'x', parentId: null, title: 'X' },
      { id: 'y', parentId: 'z', title: 'Y' },
      { id: 'z', parentId: 'y', title: 'Z' },
    ]
    expect(nestWikiTree(broken, toNode, { rootId: 'y' })).toEqual([{ title: 'Z', children: [] }])
  })
})

describe('arrangeDeletedWikiPages', () => {
  const node = (pageId: string, parentId: string | null, order = 0, pageNumber = 0) => ({
    pageId,
    parentId,
    order,
    pageNumber,
  })
  const arranged = (rows: ReturnType<typeof node>[]) =>
    arrangeDeletedWikiPages(rows).map(({ pageId, depth }) => [pageId, depth])

  it('親の下に子・孫を前順で並べ、段数を付ける', () => {
    expect(arranged([node('c', 'b'), node('a', null), node('b', 'a')])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ])
  })

  it('親が一覧に無いものは先頭の段にし、入力の順を保つ', () => {
    expect(arranged([node('x', 'alive'), node('y', null), node('z', 'alive')])).toEqual([
      ['x', 0],
      ['y', 0],
      ['z', 0],
    ])
  })

  it('兄弟は削除時の並び順、同じなら番号順', () => {
    expect(arranged([node('p', null), node('c3', 'p', 1, 9), node('c2', 'p', 0, 5), node('c1', 'p', 0, 4)])).toEqual([
      ['p', 0],
      ['c1', 1],
      ['c2', 1],
      ['c3', 1],
    ])
  })

  it('循環していても止まり、すべての行を一度ずつ返す', () => {
    expect(arranged([node('a', 'b'), node('b', 'a'), node('s', 's')])).toEqual([
      ['s', 0],
      ['a', 0],
      ['b', 1],
    ])
  })
})
