/**
 * Wiki アナウンスの Slack 通知の判定(wiki-announcement-notify-rule.ts)
 */

import {
  canSeeWikiAnnounce,
  isValidWikiAnnounceSchedule,
  MAX_WIKI_ANNOUNCE_SCHEDULE_MS,
  resolveWikiAnnounceScheduledAt,
  wikiAnnounceScheduleParts,
  wikiAnnounceStateOf,
} from '@/lib/wiki/wiki-announcement-notify-rule'
import { describe, expect, it } from 'vitest'

describe('wikiAnnounceStateOf', () => {
  it('予約中があれば予約中、送信済みだけなら通知済み、どちらも無ければ未通知', () => {
    expect(wikiAnnounceStateOf(['sent', 'scheduled'])).toBe('scheduled')
    expect(wikiAnnounceStateOf(['sent', 'canceled'])).toBe('sent')
    expect(wikiAnnounceStateOf(['canceled', 'skipped'])).toBe('none')
    expect(wikiAnnounceStateOf([])).toBe('none')
  })
})

describe('canSeeWikiAnnounce', () => {
  it('editor 以上だけが通知の履歴と状態を見られる', () => {
    expect(canSeeWikiAnnounce('owner')).toBe(true)
    expect(canSeeWikiAnnounce('editor')).toBe(true)
    expect(canSeeWikiAnnounce('viewer')).toBe(false)
    expect(canSeeWikiAnnounce(null)).toBe(false)
  })
})

describe('isValidWikiAnnounceSchedule', () => {
  const now = new Date('2026-11-23T00:00:00.000Z')
  const at = (ms: number) => new Date(now.getTime() + ms)

  const STEP = 15 * 60 * 1000

  it('15分刻みで、未来で、上限より先でない日時だけを受け付ける', () => {
    expect(isValidWikiAnnounceSchedule(at(STEP), now)).toBe(true)
    expect(isValidWikiAnnounceSchedule(at(MAX_WIKI_ANNOUNCE_SCHEDULE_MS), now)).toBe(true)
    expect(isValidWikiAnnounceSchedule(now, now)).toBe(false)
    expect(isValidWikiAnnounceSchedule(at(-STEP), now)).toBe(false)
    expect(isValidWikiAnnounceSchedule(at(MAX_WIKI_ANNOUNCE_SCHEDULE_MS + STEP), now)).toBe(false)
  })

  it('15分刻みでない時刻は受け付けない(変更の画面が刻みに切り下げても、保存済みの時刻がずれない)', () => {
    expect(isValidWikiAnnounceSchedule(at(STEP + 7 * 60 * 1000), now)).toBe(false)
    expect(isValidWikiAnnounceSchedule(at(STEP + 1), now)).toBe(false)
  })
})

describe('wikiAnnounceScheduleParts / resolveWikiAnnounceScheduledAt', () => {
  const TZ = 'Asia/Tokyo'

  it('利用者のタイムゾーンの日付と分にし、新しい予約は刻みに切り上げる(日をまたげば翌日)', () => {
    expect(wikiAnnounceScheduleParts(new Date('2026-11-23T03:07:00Z'), TZ, true)).toEqual({
      date: '2026-11-23',
      minutes: 12 * 60 + 15,
    })
    expect(wikiAnnounceScheduleParts(new Date('2026-11-23T14:50:00Z'), TZ, true)).toEqual({
      date: '2026-11-24',
      minutes: 0,
    })
    expect(wikiAnnounceScheduleParts(new Date('2026-11-23T03:07:00Z'), TZ, false).minutes).toBe(12 * 60)
  })

  it('選んだ日付と時刻を利用者のタイムゾーンで絶対時刻にする', () => {
    expect(resolveWikiAnnounceScheduledAt({ date: '2026-11-24', minutes: 9 * 60 + 30 }, TZ)).toEqual(
      new Date('2026-11-24T00:30:00Z'),
    )
  })

  it('変更で日時を変えていなければ、夏時間の終わりの重なる時間帯でも保存済みの時刻を保つ', () => {
    const tz = 'America/New_York'
    // 2027-11-07 は 2:00 EDT → 1:00 EST。06:30 UTC は 2 回目の 01:30(EST)
    const at = new Date('2027-11-07T06:30:00Z')
    const parts = wikiAnnounceScheduleParts(at, tz, false)
    expect(parts).toEqual({ date: '2027-11-07', minutes: 90 })
    expect(resolveWikiAnnounceScheduledAt(parts, tz, { at, parts })).toBe(at)
    // 変えた場合だけ選び直す(重なる時刻は早い側になる)
    expect(resolveWikiAnnounceScheduledAt({ ...parts, minutes: 105 }, tz, { at, parts })).toEqual(
      new Date('2027-11-07T05:45:00Z'),
    )
  })
})
