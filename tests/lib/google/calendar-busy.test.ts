/** 「毎週この曜日のこの時刻」は壁時計時刻の指定なので、DST を挟んでも時刻がずれないことを固定する */

import { startOfWeek } from '@/lib/day'
import { expandBusyTimes, mergeBusySlots } from '@/lib/google/calendar-busy'
import { describe, expect, it } from 'vitest'

describe('expandBusyTimes', () => {
  it('該当曜日だけを展開する(Asia/Tokyo)', () => {
    const weekStart = startOfWeek('2026-03-02', 'Asia/Tokyo')
    const slots = expandBusyTimes([{ weekdays: [1], startMin: 540, endMin: 1080 }], weekStart, 'Asia/Tokyo')

    // 月曜 9:00-18:00 JST = 00:00-09:00 UTC
    expect(slots).toEqual([{ start: '2026-03-02T00:00:00.000Z', end: '2026-03-02T09:00:00.000Z' }])
  })

  it('endMin が 1440 なら翌日 0:00 になる', () => {
    const weekStart = startOfWeek('2026-03-02', 'Asia/Tokyo')
    const slots = expandBusyTimes([{ weekdays: [1], startMin: 1410, endMin: 1440 }], weekStart, 'Asia/Tokyo')

    expect(slots).toEqual([{ start: '2026-03-02T14:30:00.000Z', end: '2026-03-02T15:00:00.000Z' }])
  })

  it('DST 切替を挟んでも壁時計時刻は変わらない(America/New_York)', () => {
    const tz = 'America/New_York'
    // 2026-03-08(日)に夏時間が始まる週
    const weekStart = startOfWeek('2026-03-02', tz)
    const slots = expandBusyTimes([{ weekdays: [1, 0], startMin: 540, endMin: 1080 }], weekStart, tz)

    expect(slots).toEqual([
      // 月曜は EST(UTC-5)
      { start: '2026-03-02T14:00:00.000Z', end: '2026-03-02T23:00:00.000Z' },
      // 日曜は EDT(UTC-4)。絶対時間の加算だと 1 時間ずれる
      { start: '2026-03-08T13:00:00.000Z', end: '2026-03-08T22:00:00.000Z' },
    ])
  })
})

describe('mergeBusySlots', () => {
  it('重なりと隣接を 1 区間へまとめる', () => {
    const merged = mergeBusySlots([
      { start: '2026-03-02T01:00:00.000Z', end: '2026-03-02T02:00:00.000Z' },
      { start: '2026-03-02T02:00:00.000Z', end: '2026-03-02T03:00:00.000Z' },
      { start: '2026-03-02T02:30:00.000Z', end: '2026-03-02T04:00:00.000Z' },
      { start: '2026-03-02T05:00:00.000Z', end: '2026-03-02T06:00:00.000Z' },
    ])

    expect(merged).toEqual([
      { start: '2026-03-02T01:00:00.000Z', end: '2026-03-02T04:00:00.000Z' },
      { start: '2026-03-02T05:00:00.000Z', end: '2026-03-02T06:00:00.000Z' },
    ])
  })

  it('長さ 0 以下の区間は捨てる', () => {
    expect(mergeBusySlots([{ start: '2026-03-02T01:00:00.000Z', end: '2026-03-02T01:00:00.000Z' }])).toEqual([])
  })
})
