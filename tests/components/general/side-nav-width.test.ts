/**
 * サイドメニューの幅の丸めと、保存した値の読み取り(side-nav-width.ts)
 */

import {
  clampSideNavWidth,
  parseSideNavWidth,
  SIDE_NAV_WIDTH_DEFAULT,
  SIDE_NAV_WIDTH_MAX,
  SIDE_NAV_WIDTH_MIN,
} from '@/components/general/side-nav-width'
import { describe, expect, it } from 'vitest'

describe('clampSideNavWidth', () => {
  it('範囲内はそのまま、小数は整数に丸める', () => {
    expect(clampSideNavWidth(300)).toBe(300)
    expect(clampSideNavWidth(300.6)).toBe(301)
  })

  it('最小・最大を超えた値は端に寄せる', () => {
    expect(clampSideNavWidth(SIDE_NAV_WIDTH_MIN - 1)).toBe(SIDE_NAV_WIDTH_MIN)
    expect(clampSideNavWidth(-100)).toBe(SIDE_NAV_WIDTH_MIN)
    expect(clampSideNavWidth(SIDE_NAV_WIDTH_MAX + 1)).toBe(SIDE_NAV_WIDTH_MAX)
  })
})

describe('parseSideNavWidth', () => {
  it('保存した値を読み、範囲外なら端に寄せる', () => {
    expect(parseSideNavWidth('320')).toBe(320)
    expect(parseSideNavWidth('100')).toBe(SIDE_NAV_WIDTH_MIN)
    expect(parseSideNavWidth('9999')).toBe(SIDE_NAV_WIDTH_MAX)
  })

  it.each([undefined, null, '', 'abc', 'NaN', 'Infinity'])('未保存・数値でない値は既定の幅 (%s)', (raw) => {
    expect(parseSideNavWidth(raw)).toBe(SIDE_NAV_WIDTH_DEFAULT)
  })
})
