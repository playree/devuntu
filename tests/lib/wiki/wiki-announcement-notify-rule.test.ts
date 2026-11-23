/**
 * Wiki アナウンスの Slack 通知の判定(wiki-announcement-notify-rule.ts)
 */

import {
  canSeeWikiAnnounce,
  isValidWikiAnnounceSchedule,
  MAX_WIKI_ANNOUNCE_SCHEDULE_MS,
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

  it('未来で、上限より先でない日時だけを受け付ける', () => {
    expect(isValidWikiAnnounceSchedule(at(1), now)).toBe(true)
    expect(isValidWikiAnnounceSchedule(at(MAX_WIKI_ANNOUNCE_SCHEDULE_MS), now)).toBe(true)
    expect(isValidWikiAnnounceSchedule(now, now)).toBe(false)
    expect(isValidWikiAnnounceSchedule(at(-1), now)).toBe(false)
    expect(isValidWikiAnnounceSchedule(at(MAX_WIKI_ANNOUNCE_SCHEDULE_MS + 1), now)).toBe(false)
  })
})
