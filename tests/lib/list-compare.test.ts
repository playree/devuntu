/**
 * 文字列の列の比較(list-compare.ts)
 */

import { isSameOrder, isSameSet } from '@/lib/list-compare'
import { describe, expect, it } from 'vitest'

describe('isSameSet', () => {
  it('並びと重複を問わず、同じ値の集合か', () => {
    expect(isSameSet(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(isSameSet(['a', 'a', 'b'], ['b', 'a'])).toBe(true)
    expect(isSameSet([], [])).toBe(true)
    expect(isSameSet(['a'], ['a', 'b'])).toBe(false)
    expect(isSameSet(['a', 'c'], ['a', 'b'])).toBe(false)
  })
})

describe('isSameOrder', () => {
  it('同じ並びの列か', () => {
    expect(isSameOrder(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(isSameOrder(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(isSameOrder(['a'], ['a', 'b'])).toBe(false)
  })
})
