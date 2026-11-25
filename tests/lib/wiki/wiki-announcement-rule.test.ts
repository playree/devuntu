/**
 * Wiki のアナウンス用スペースの純粋関数(wiki-announcement-rule.ts)
 */

import {
  groupWikiAnnouncementArchive,
  parseWikiAnnouncementParams,
  wikiAnnouncementHref,
  wikiAnnouncementPeriodRange,
} from '@/lib/wiki/wiki-announcement-rule'
import { describe, expect, it } from 'vitest'

describe('wikiAnnouncementPeriodRange', () => {
  it('月は閲覧者のタイムゾーンの月初から翌月初まで', () => {
    expect(wikiAnnouncementPeriodRange({ month: '2026-11' }, 'Asia/Tokyo')).toEqual({
      gte: new Date('2026-10-31T15:00:00.000Z'),
      lt: new Date('2026-11-30T15:00:00.000Z'),
    })
  })

  it('12 月は翌年の 1 月初まで', () => {
    expect(wikiAnnouncementPeriodRange({ month: '2026-12' }, 'UTC')).toEqual({
      gte: new Date('2026-12-01T00:00:00.000Z'),
      lt: new Date('2027-01-01T00:00:00.000Z'),
    })
  })

  it('年は 1 月初から翌年の 1 月初まで。月があれば月を採る', () => {
    expect(wikiAnnouncementPeriodRange({ year: '2026' }, 'UTC')).toEqual({
      gte: new Date('2026-01-01T00:00:00.000Z'),
      lt: new Date('2027-01-01T00:00:00.000Z'),
    })
    expect(wikiAnnouncementPeriodRange({ year: '2025', month: '2026-02' }, 'UTC')?.gte).toEqual(
      new Date('2026-02-01T00:00:00.000Z'),
    )
  })

  it('指定が無い・形式外なら全期間(null)', () => {
    expect(wikiAnnouncementPeriodRange({}, 'UTC')).toBeNull()
    expect(wikiAnnouncementPeriodRange({ month: '2026-13', year: '26' }, 'UTC')).toBeNull()
  })
})

describe('groupWikiAnnouncementArchive', () => {
  it('新しい順の年月を、年ごとに件数を足してまとめる', () => {
    expect(
      groupWikiAnnouncementArchive([
        { month: '2026-11', count: 3 },
        { month: '2026-02', count: 1 },
        { month: '2025-12', count: 2 },
      ]),
    ).toEqual([
      {
        year: '2026',
        count: 4,
        months: [
          { month: '2026-11', count: 3 },
          { month: '2026-02', count: 1 },
        ],
      },
      { year: '2025', count: 2, months: [{ month: '2025-12', count: 2 }] },
    ])
  })
})

describe('parseWikiAnnouncementParams / wikiAnnouncementHref', () => {
  it('形式外の月・年は捨て、月があれば年は捨てる', () => {
    expect(parseWikiAnnouncementParams({ month: '2026-11', year: '2026', tag: ' 重要 ' })).toEqual({
      month: '2026-11',
      tag: '重要',
    })
    expect(parseWikiAnnouncementParams({ month: 'x', year: ['2025', '2026'] })).toEqual({ year: '2025' })
    expect(parseWikiAnnouncementParams({})).toEqual({})
  })

  it('絞り込みをトップの URL にする', () => {
    expect(wikiAnnouncementHref('NEWS', {})).toBe('/wiki/NEWS')
    expect(wikiAnnouncementHref('NEWS', { month: '2026-11', year: '2026', tag: '重要' })).toBe(
      '/wiki/NEWS?month=2026-11&tag=%E9%87%8D%E8%A6%81',
    )
    expect(wikiAnnouncementHref('NEWS', { year: '2026' })).toBe('/wiki/NEWS?year=2026')
  })
})
