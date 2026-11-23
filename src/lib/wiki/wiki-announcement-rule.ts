/**
 * Wiki のアナウンス用スペースの定数と純粋関数
 *
 * サーバー / クライアントの双方から import する。DB アクセスは `wiki-announcement.ts` を参照。
 */

import { addMonthsDateOnly, zonedDayBounds } from '../day'

/** サイドバーに出す最新のアナウンスの件数 */
export const WIKI_ANNOUNCEMENT_SIDEBAR_LIMIT = 10
/** MCP の get_wiki_tree で返すアナウンスの件数の上限(新しい順) */
export const MAX_WIKI_ANNOUNCEMENT_TREE = 200
/** 一覧の 1 ページの件数の上限 */
export const MAX_WIKI_ANNOUNCEMENT_PAGE_SIZE = 100

/** バックナンバーの月(YYYY-MM) */
export const WIKI_ANNOUNCEMENT_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/
/** バックナンバーの年(YYYY) */
export const WIKI_ANNOUNCEMENT_YEAR_PATTERN = /^\d{4}$/

/** 一覧の期間。月を指定すればその月、年だけならその年。どちらも無ければ全期間 */
export type WikiAnnouncementPeriod = { month?: string; year?: string }

/**
 * 期間を、閲覧者のタイムゾーンでの [gte, lt) にする。指定が無い・形式外なら null(全期間)。
 * 月と年の両方があれば月を採る
 */
export const wikiAnnouncementPeriodRange = (
  { month, year }: WikiAnnouncementPeriod,
  timezone: string,
): { gte: Date; lt: Date } | null => {
  const isMonth = month !== undefined && WIKI_ANNOUNCEMENT_MONTH_PATTERN.test(month)
  const isYear = year !== undefined && WIKI_ANNOUNCEMENT_YEAR_PATTERN.test(year)
  if (!isMonth && !isYear) {
    return null
  }
  const first = isMonth ? `${month}-01` : `${year}-01-01`
  const next = addMonthsDateOnly(first, isMonth ? 1 : 12)
  return {
    gte: new Date(zonedDayBounds(first, timezone).startMs),
    lt: new Date(zonedDayBounds(next, timezone).startMs),
  }
}

/** 年月ごとの件数 */
export type WikiAnnouncementMonthCount = { month: string; count: number }

/** バックナンバーの年ごとのまとまり(新しい順) */
export type WikiAnnouncementArchiveYear = { year: string; count: number; months: WikiAnnouncementMonthCount[] }

/** 年月ごとの件数(新しい順)を、年ごとにまとめる */
export const groupWikiAnnouncementArchive = (
  months: readonly WikiAnnouncementMonthCount[],
): WikiAnnouncementArchiveYear[] => {
  const years: WikiAnnouncementArchiveYear[] = []
  for (const row of months) {
    const year = row.month.slice(0, 4)
    const last = years.at(-1)
    if (last?.year === year) {
      last.count += row.count
      last.months.push(row)
    } else {
      years.push({ year, count: row.count, months: [row] })
    }
  }
  return years
}

/** 一覧の絞り込み。URL のクエリ(`?month=` / `?year=` / `?tag=`)で持つ。タグは名前 */
export type WikiAnnouncementFilter = { month?: string; year?: string; tag?: string }

const firstOf = (value: string | string[] | undefined): string | undefined =>
  [value ?? []].flat()[0]?.trim() || undefined

/** URL のクエリを絞り込みに読む。形式外の月・年は捨て、月があれば年は捨てる(手で書き換えた URL でも検証で弾かれないように) */
export const parseWikiAnnouncementParams = (params: {
  month?: string | string[]
  year?: string | string[]
  tag?: string | string[]
}): WikiAnnouncementFilter => {
  const month = firstOf(params.month)
  const year = firstOf(params.year)
  const tag = firstOf(params.tag)
  const validMonth = month && WIKI_ANNOUNCEMENT_MONTH_PATTERN.test(month) ? month : undefined
  const validYear = !validMonth && year && WIKI_ANNOUNCEMENT_YEAR_PATTERN.test(year) ? year : undefined
  return {
    ...(validMonth ? { month: validMonth } : {}),
    ...(validYear ? { year: validYear } : {}),
    ...(tag ? { tag } : {}),
  }
}

/** 絞り込みをスペースのトップの URL にする */
export const wikiAnnouncementHref = (spaceKey: string, filter: WikiAnnouncementFilter): string => {
  const params = new URLSearchParams()
  if (filter.month) {
    params.set('month', filter.month)
  } else if (filter.year) {
    params.set('year', filter.year)
  }
  if (filter.tag) {
    params.set('tag', filter.tag)
  }
  const query = params.toString()
  return query ? `/wiki/${spaceKey}?${query}` : `/wiki/${spaceKey}`
}
