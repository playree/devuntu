import { isDateOnlyOverdue, startOfWeek, weekRange, zonedMinutes } from '@/lib/day'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.useRealTimers()
})

describe('weekRange', () => {
  it('timeMin / timeMax が週初日と翌週初日の 0:00 になる', () => {
    const tz = 'Asia/Tokyo'
    const { timeMin, timeMax } = weekRange(startOfWeek('2026-03-04', tz), tz)
    // JST 0:00 = 前日 15:00 UTC
    expect(timeMin).toBe('2026-03-01T15:00:00.000Z')
    expect(timeMax).toBe('2026-03-08T15:00:00.000Z')
  })

  it('DST 開始を挟む週でも壁時計の 0:00 を保つ', () => {
    // 2026-03-08 に EST(-05:00) → EDT(-04:00) へ切り替わる週
    const tz = 'America/New_York'
    const { timeMin, timeMax } = weekRange(startOfWeek('2026-03-04', tz), tz)
    expect(timeMin).toBe('2026-03-02T05:00:00.000Z')
    expect(timeMax).toBe('2026-03-09T04:00:00.000Z')
  })

  it('DST 終了を挟む週でも壁時計の 0:00 を保つ', () => {
    // 2026-11-01 に EDT(-04:00) → EST(-05:00) へ戻る週
    const tz = 'America/New_York'
    const { timeMin, timeMax } = weekRange(startOfWeek('2026-10-26', tz), tz)
    expect(timeMin).toBe('2026-10-26T04:00:00.000Z')
    expect(timeMax).toBe('2026-11-02T05:00:00.000Z')
  })
})

describe('zonedMinutes', () => {
  it('1440 は翌日 0:00 になる', () => {
    expect(zonedMinutes('2026-03-04', 1440, 'Asia/Tokyo').toISOString()).toBe('2026-03-04T15:00:00.000Z')
  })

  it('DST 終了日に 2 度現れる時刻は、実行時期に依らず早い側になる', () => {
    // America/New_York の 2026-11-01 01:30 は EDT(-04:00) と EST(-05:00) の 2 回現れる
    for (const systemTime of ['2026-07-01T00:00:00Z', '2026-12-01T00:00:00Z']) {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(systemTime))
      expect(zonedMinutes('2026-11-01', 90, 'America/New_York').toISOString(), systemTime).toBe(
        '2026-11-01T05:30:00.000Z',
      )
    }
  })

  it('DST 開始日に存在しない時刻は切替後へ送られる', () => {
    // America/New_York の 2026-03-08 02:30 は存在しないので 03:30 EDT になる
    expect(zonedMinutes('2026-03-08', 150, 'America/New_York').toISOString()).toBe('2026-03-08T07:30:00.000Z')
  })
})

describe('isDateOnlyOverdue', () => {
  // 期日は UTC 0:00 で保存される値なので、テストの入力もその形で作る
  const dueDate = (dateOnly: string) => new Date(`${dateOnly}T00:00:00Z`)

  it('期日が昨日なら期限切れ', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-04T00:00:00Z'))
    expect(isDateOnlyOverdue(dueDate('2026-03-03'), 'Asia/Tokyo')).toBe(true)
  })

  it('期日が今日なら期限切れにしない', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-04T00:00:00Z'))
    expect(isDateOnlyOverdue(dueDate('2026-03-04'), 'Asia/Tokyo')).toBe(false)
  })

  it('期日が明日なら期限切れにしない', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-04T00:00:00Z'))
    expect(isDateOnlyOverdue(dueDate('2026-03-05'), 'Asia/Tokyo')).toBe(false)
  })

  it('期日が未指定なら期限切れにしない', () => {
    expect(isDateOnlyOverdue(null)).toBe(false)
    expect(isDateOnlyOverdue(undefined)).toBe(false)
  })

  it('同じ時刻でもタイムゾーンで「今日」がずれる', () => {
    // UTC 2026-03-04 02:00 は JST では 03-04 11:00、NY では 03-03 21:00
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-04T02:00:00Z'))
    expect(isDateOnlyOverdue(dueDate('2026-03-03'), 'Asia/Tokyo')).toBe(true)
    expect(isDateOnlyOverdue(dueDate('2026-03-03'), 'America/New_York')).toBe(false)
  })
})
