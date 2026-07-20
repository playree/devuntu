import dayjs, { Dayjs, extend } from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

extend(utc)
extend(timezone)
extend(isoWeek)

export const now = () => dayjs()
export const nowDate = () => now().toDate()

/** 日本時間フォーマット */
export const dayformat = (date: Dayjs | Date | null, format?: 'jp-simple') => {
  if (!date) {
    return ''
  }

  switch (format) {
    case 'jp-simple':
      return dayjs(date).tz('Asia/Tokyo').format('YYYY-MM-DD HH:mm:ss')
  }
  return dayjs(date).tz('Asia/Tokyo').format()
}

/** xx分以内かのチェック */
export const withinMinutes = (date: Date, min: number) => {
  const now = dayjs()
  const target = dayjs(date)
  const diff = now.diff(target, 'minute')
  return diff <= min
}

/** タイムゾーン(固定) */
export const TOKYO_TZ = 'Asia/Tokyo'

/** 指定日(YYYY-MM-DD等)を含む週の起点(月曜 0:00, Asia/Tokyo)を返す。未指定・不正時は今日基準 */
export const startOfWeek = (date?: string | null) => {
  const base = date ? dayjs.tz(date, TOKYO_TZ) : dayjs().tz(TOKYO_TZ)
  const valid = base.isValid() ? base : dayjs().tz(TOKYO_TZ)
  // isoWeek は月曜始まり
  return valid.startOf('isoWeek')
}

/** 週の起点から7日分の Dayjs 配列(月曜〜日曜) */
export const weekDays = (weekStart: Dayjs) => Array.from({ length: 7 }, (_, i) => weekStart.add(i, 'day'))

/** 週の取得レンジ(ISO文字列。timeMin: 週初日0:00, timeMax: 翌週初日0:00) */
export const weekRange = (weekStart: Dayjs) => ({
  timeMin: weekStart.toISOString(),
  timeMax: weekStart.add(7, 'day').toISOString(),
})

/** ISO文字列を Asia/Tokyo の Dayjs に変換 */
export const toTokyo = (date: string | Date | Dayjs) => dayjs(date).tz(TOKYO_TZ)
