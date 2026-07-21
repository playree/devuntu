import dayjs, { Dayjs, extend } from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

extend(utc)
extend(timezone)
extend(isoWeek)

export const now = () => dayjs()
export const nowDate = () => now().toDate()

/** タイムゾーン(既定のフォールバック)。env の DEFAULT_TIMEZONE 未設定時などに使用 */
export const DEFAULT_TZ = 'Asia/Tokyo'

/** 後方互換のためのエイリアス */
export const TOKYO_TZ = DEFAULT_TZ

/** 選択候補として表示する世界の主要都市のタイムゾーン(IANA名) */
export const COMMON_TIMEZONES = [
  'Pacific/Midway',
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Sao_Paulo',
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Pacific/Auckland',
]

/** タイムゾーンの現在の UTC オフセット(分)。ソート用。DST は現在時刻基準 */
export const tzOffsetMinutes = (tz: string): number => dayjs().tz(tz).utcOffset()

/** `(UTC+09:00) Asia/Tokyo` 形式の表示ラベルを返す。DST は現在時刻基準で反映される */
export const tzOffsetLabel = (tz: string): string => `(UTC${dayjs().tz(tz).format('Z')}) ${tz}`

/** IANA タイムゾーン名として妥当かを判定する */
export const isValidTimezone = (tz: string): boolean => {
  if (!tz) {
    return false
  }
  try {
    // 不正な TZ 名は RangeError を投げる
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** 指定タイムゾーンで日時をフォーマット(既定は Asia/Tokyo) */
export const dayformat = (date: Dayjs | Date | null, format?: 'tz-simple', tz: string = DEFAULT_TZ) => {
  if (!date) {
    return ''
  }

  switch (format) {
    case 'tz-simple':
      return dayjs(date).tz(tz).format('YYYY-MM-DD HH:mm:ss')
  }
  return dayjs(date).tz(tz).format()
}

/** xx分以内かのチェック */
export const withinMinutes = (date: Date, min: number) => {
  const now = dayjs()
  const target = dayjs(date)
  const diff = now.diff(target, 'minute')
  return diff <= min
}

/** 指定日(YYYY-MM-DD等)を含む週の起点(月曜 0:00, 指定TZ)を返す。未指定・不正時は今日基準 */
export const startOfWeek = (date?: string | null, tz: string = DEFAULT_TZ) => {
  const base = date ? dayjs.tz(date, tz) : dayjs().tz(tz)
  const valid = base.isValid() ? base : dayjs().tz(tz)
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

/** ISO文字列等を指定タイムゾーンの Dayjs に変換(既定は Asia/Tokyo) */
export const toZone = (date: string | Date | Dayjs, tz: string = DEFAULT_TZ) => dayjs(date).tz(tz)
