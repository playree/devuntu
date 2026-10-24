import {
  clipToZonedDay,
  DAY_MS,
  isDateOnlyOverdue,
  isValidTimezone,
  msBefore,
  startOfWeek,
  weekRange,
  zonedDayBounds,
  zonedMinutes,
} from '@/lib/day'
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

describe('isValidTimezone', () => {
  it.each(['Asia/Tokyo', 'America/New_York', 'UTC', 'Etc/GMT+5'])('IANA 名は通す (%s)', (tz) => {
    expect(isValidTimezone(tz)).toBe(true)
  })

  it.each(['-05:00', '+0900', '+09'])('固定オフセットは夏時間に追従しないので弾く (%s)', (tz) => {
    // Intl.DateTimeFormat はこれらを受け付けるので、自前で弾いている
    expect(isValidTimezone(tz)).toBe(false)
  })

  it.each(['', 'Asia/Tokio'])('空文字や存在しない名前は弾く (%s)', (tz) => {
    expect(isValidTimezone(tz)).toBe(false)
  })
})

describe('msBefore', () => {
  const base = new Date('2026-09-08T10:00:00.000Z')

  it('指定した時間だけ過去の時刻を返す', () => {
    expect(msBefore(base, DAY_MS).toISOString()).toBe('2026-09-07T10:00:00.000Z')
  })

  it('0 なら基準時刻のまま(猶予なしの手順で使う)', () => {
    expect(msBefore(base, 0).getTime()).toBe(base.getTime())
  })

  it('元の Date を書き換えない', () => {
    msBefore(base, 1000)
    expect(base.toISOString()).toBe('2026-09-08T10:00:00.000Z')
  })
})

describe('clipToZonedDay', () => {
  /** 暦日 1 日に切り取る(日の範囲は zonedDayBounds で求める) */
  const clip = (date: string, tz: string, start: string, end: string) =>
    clipToZonedDay(zonedDayBounds(date, tz), new Date(start).getTime(), new Date(end).getTime(), tz)

  it('日をまたぐ区間はその日の分だけ切り取る', () => {
    // Asia/Tokyo の 3/4 22:00 〜 3/5 02:00
    const range = ['2026-03-04T13:00:00Z', '2026-03-04T17:00:00Z'] as const
    expect(clip('2026-03-04', 'Asia/Tokyo', ...range)).toEqual({ startMin: 22 * 60, endMin: 1440 })
    expect(clip('2026-03-05', 'Asia/Tokyo', ...range)).toEqual({ startMin: 0, endMin: 2 * 60 })
  })

  it('重ならなければ null', () => {
    expect(clip('2026-03-06', 'Asia/Tokyo', '2026-03-04T13:00:00Z', '2026-03-04T17:00:00Z')).toBeNull()
  })

  it('夏時間が終わる日(25 時間)も、現地の 23:00〜24:00 をその日に含め、壁時計の位置で返す', () => {
    // Europe/Berlin 2026-10-25 は 03:00 CEST → 02:00 CET。23:00 CET = 22:00Z
    expect(clip('2026-10-25', 'Europe/Berlin', '2026-10-25T22:00:00Z', '2026-10-25T23:00:00Z')).toEqual({
      startMin: 23 * 60,
      endMin: 1440,
    })
    // 切替後の 10:00 CET = 09:00Z は 10:00 の位置
    expect(clip('2026-10-25', 'Europe/Berlin', '2026-10-25T09:00:00Z', '2026-10-25T10:00:00Z')).toEqual({
      startMin: 10 * 60,
      endMin: 11 * 60,
    })
  })

  it('夏時間が始まる日(23 時間)も壁時計の位置で返す', () => {
    // Europe/Berlin 2026-03-29 は 02:00 CET → 03:00 CEST。10:00 CEST = 08:00Z
    expect(clip('2026-03-29', 'Europe/Berlin', '2026-03-29T08:00:00Z', '2026-03-29T09:00:00Z')).toEqual({
      startMin: 10 * 60,
      endMin: 11 * 60,
    })
    // 前日の 23:00 CET(22:00Z)は含めない
    expect(clip('2026-03-29', 'Europe/Berlin', '2026-03-28T22:00:00Z', '2026-03-28T23:00:00Z')).toBeNull()
  })
})
