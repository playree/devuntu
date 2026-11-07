/**
 * チケット本文の目次の位置計算の単体テスト
 *
 * 目次の部品(src/components/markdown/markdown-toc.tsx)は DOM の位置を読むため、
 * 読み取った値から深さ・現在の見出し・一覧の追従量を決める部分だけをここで確かめる。
 */

import {
  currentThreshold,
  findCurrentHeading,
  pickCurrentHeading,
  revealScrollTop,
  tocDepths,
} from '@/lib/markdown-toc'
import { describe, expect, it } from 'vitest'

describe('tocDepths', () => {
  it('いちばん浅い見出しを 0 とした深さにする', () => {
    expect(tocDepths([2, 3, 3, 2])).toEqual([0, 1, 1, 0])
  })

  it('h1 があれば h1 が 0', () => {
    expect(tocDepths([1, 2, 3])).toEqual([0, 1, 2])
  })

  it('途中で浅い見出しが出てもそれを基準にする', () => {
    expect(tocDepths([3, 2, 3])).toEqual([1, 0, 1])
  })
})

describe('currentThreshold', () => {
  it('通常は上端から高さの 20% の位置', () => {
    expect(currentThreshold({ top: 0, scrollTop: 100, clientHeight: 1000, scrollHeight: 5000 })).toBe(200)
  })

  it('スクロール元の上端の位置を足す', () => {
    expect(currentThreshold({ top: 50, scrollTop: 100, clientHeight: 1000, scrollHeight: 5000 })).toBe(250)
  })

  it('末尾までスクロールしたら高さ全体に広げる', () => {
    expect(currentThreshold({ top: 0, scrollTop: 4000, clientHeight: 1000, scrollHeight: 5000 })).toBe(1000)
  })

  it('小数の端数があっても末尾とみなす', () => {
    expect(currentThreshold({ top: 0, scrollTop: 3999.5, clientHeight: 1000, scrollHeight: 5000 })).toBe(1000)
  })

  it('スクロールしない本文は末尾扱いしない', () => {
    expect(currentThreshold({ top: 0, scrollTop: 0, clientHeight: 1000, scrollHeight: 1000 })).toBe(200)
  })
})

describe('findCurrentHeading', () => {
  const rects = (tops: number[]) => tops.map((top) => ({ top, height: 20 }))

  it('閾値より上にある最後の見出し', () => {
    expect(findCurrentHeading(rects([-300, -100, 150, 600]), 200)).toBe(2)
  })

  it('閾値ちょうどは含む', () => {
    expect(findCurrentHeading(rects([100, 200, 300]), 200)).toBe(1)
  })

  it('最初の見出しより上なら -1', () => {
    expect(findCurrentHeading(rects([300, 600]), 200)).toBe(-1)
  })

  it('見出しが無ければ -1', () => {
    expect(findCurrentHeading([], 200)).toBe(-1)
  })

  it('高さ 0 の見出しは飛ばす', () => {
    expect(
      findCurrentHeading(
        [
          { top: 0, height: 20 },
          { top: 0, height: 0 },
        ],
        200,
      ),
    ).toBe(0)
  })
})

describe('pickCurrentHeading', () => {
  const box = { top: 0, scrollTop: 1000, clientHeight: 1000, scrollHeight: 5000 }
  const rects = [
    { top: -500, height: 20 },
    { top: 0, height: 20 },
    { top: 120, height: 20 },
    { top: 600, height: 20 },
  ]

  it('選んだ直後のスクロール位置にあれば選んだ見出しを現在とする', () => {
    expect(pickCurrentHeading(rects, box, { index: 1, scrollTop: 1000 })).toBe(1)
  })

  it('末尾で選んだ見出しが先頭まで上がらなくても選んだ見出しを現在とする', () => {
    const end = { ...box, scrollTop: 4000 }
    expect(pickCurrentHeading(rects, end, { index: 2, scrollTop: 4000 })).toBe(2)
  })

  it('スクロールしたら通常の判定に戻る', () => {
    expect(pickCurrentHeading(rects, box, { index: 1, scrollTop: 900 })).toBe(2)
  })

  it('選んでいなければ通常の判定', () => {
    expect(pickCurrentHeading(rects, box)).toBe(2)
  })

  it('表示されていない見出しは優先しない', () => {
    const hidden = rects.map((rect, i) => (i === 1 ? { ...rect, height: 0 } : rect))
    expect(pickCurrentHeading(hidden, box, { index: 1, scrollTop: 1000 })).toBe(2)
  })
})

describe('revealScrollTop', () => {
  const list = { scrollTop: 100, clientHeight: 200 }

  it('見えている項目なら動かさない', () => {
    expect(revealScrollTop({ ...list, itemTop: 150, itemHeight: 20 })).toBe(100)
  })

  it('上にはみ出た項目は上端に合わせる', () => {
    expect(revealScrollTop({ ...list, itemTop: 80, itemHeight: 20 })).toBe(80)
  })

  it('下にはみ出た項目は下端に合わせる', () => {
    expect(revealScrollTop({ ...list, itemTop: 290, itemHeight: 20 })).toBe(110)
  })
})
