import { startOfWeek, weekRange } from '@/lib/day'
import { describe, expect, it } from 'vitest'

describe('weekRange', () => {
  it('timeMin / timeMax が週初日と翌週初日の 0:00 になる', () => {
    const tz = 'Asia/Tokyo'
    const { timeMin, timeMax } = weekRange(startOfWeek('2026-03-04', tz), tz)
    // JST 0:00 = 前日 15:00 UTC
    expect(timeMin).toBe('2026-03-01T15:00:00.000Z')
    expect(timeMax).toBe('2026-03-08T15:00:00.000Z')
  })

  it('DST 切替を挟む週でも壁時計の 0:00 を保つ', () => {
    // 2026-03-08 に EST(-05:00) → EDT(-04:00) へ切り替わる週
    const tz = 'America/New_York'
    const { timeMin, timeMax } = weekRange(startOfWeek('2026-03-04', tz), tz)
    expect(timeMin).toBe('2026-03-02T05:00:00.000Z')
    expect(timeMax).toBe('2026-03-09T04:00:00.000Z')
  })
})
