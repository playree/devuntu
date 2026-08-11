import dayjs, { Dayjs, extend } from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import isoWeek from 'dayjs/plugin/isoWeek'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

extend(utc)
extend(timezone)
extend(isoWeek)
// dateOnlyToUtc の strict parse に必要
extend(customParseFormat)

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

/**
 * 指定タイムゾーンで日時をフォーマット(既定は Asia/Tokyo)
 *
 * `date` はチケットの期日のように「日付のみ」を意味する値を扱うための書式。
 * UTC 0:00 で保存されているため、タイムゾーン変換をせず UTC のまま日付として出す。
 * `tz-minute` はかんばんのカードのように横幅が限られる場所向けに秒を落としたもの。
 */
export const dayformat = (
  date: Dayjs | Date | null,
  format?: 'tz-simple' | 'tz-minute' | 'date',
  tz: string = DEFAULT_TZ,
) => {
  if (!date) {
    return ''
  }

  switch (format) {
    case 'tz-simple':
      return dayjs(date).tz(tz).format('YYYY-MM-DD HH:mm:ss')
    case 'tz-minute':
      return dayjs(date).tz(tz).format('YYYY-MM-DD HH:mm')
    case 'date':
      return dayjs(date).utc().format('YYYY-MM-DD')
  }
  return dayjs(date).tz(tz).format()
}

/**
 * 日付のみの文字列(YYYY-MM-DD)を UTC 0:00 の Date へ変換する。不正・未指定は null。
 *
 * strict parse(第3引数 true)にしないと `2026-02-31` が `2026-03-03` へ繰り上がってしまう。
 */
export const dateOnlyToUtc = (value?: string | null): Date | null => {
  if (!value) {
    return null
  }
  const parsed = dayjs.utc(value, 'YYYY-MM-DD', true)
  return parsed.isValid() ? parsed.toDate() : null
}

/** UTC 0:00 で保存された日付を YYYY-MM-DD へ戻す(DatePicker の初期値用)。未指定は null */
export const utcToDateOnly = (date?: Date | null): string | null =>
  date ? dayjs(date).utc().format('YYYY-MM-DD') : null

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

/**
 * 週の取得レンジ(ISO文字列。timeMin: 週初日0:00, timeMax: 翌週初日0:00)
 *
 * 終端は翌週初日の暦日から tz で解決する。`.add(7, 'day')` だと `.tz()` が固定したオフセットの
 * まま加算されるため、DST の切替を挟む週で 1 時間ずれる(zonedMinutes と同じ理由)。
 */
export const weekRange = (weekStart: Dayjs, tz: string = DEFAULT_TZ) => ({
  timeMin: weekStart.toISOString(),
  timeMax: zonedMinutes(addDaysDateOnly(weekStart.format('YYYY-MM-DD'), 7), 0, tz).toISOString(),
})

/** ISO文字列等を指定タイムゾーンの Dayjs に変換(既定は Asia/Tokyo) */
export const toZone = (date: string | Date | Dayjs, tz: string = DEFAULT_TZ) => dayjs(date).tz(tz)

/** 月始まりの表示順(値は dayjs .day() のインデックス 0=日..6=土) */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

/** 曜日ラベル。インデックスは dayjs の .day() と同じ 0=日 .. 6=土 */
export const WEEKDAY_LABELS: Record<string, string[]> = {
  ja: ['日', '月', '火', '水', '木', '金', '土'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
}

/** 0:00 からの分を "HH:mm" 形式に変換(1440 は "24:00") */
export const minToHHmm = (min: number): string => {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** 暦日(YYYY-MM-DD)を日数分ずらす。UTC の暦日計算なので DST の影響を受けない */
export const addDaysDateOnly = (date: string, days: number): string =>
  dayjs.utc(date, 'YYYY-MM-DD', true).add(days, 'day').format('YYYY-MM-DD')

/**
 * 暦日(YYYY-MM-DD)と 0:00 からの分から、指定タイムゾーンの絶対時刻を作る。1440 は翌日 0:00。
 *
 * 週初日の Dayjs に分を足す方法だと、`.tz()` が固定したオフセットのまま加算されるため
 * DST の切替を挟む日で壁時計時刻がずれる。日付+時刻の文字列としてタイムゾーン解決させることで防ぐ。
 */
export const zonedMinutes = (date: string, min: number, tz: string = DEFAULT_TZ) =>
  // 24:00 以降は翌日の時刻として解決させる
  dayjs.tz(`${addDaysDateOnly(date, Math.floor(min / 1440))} ${minToHHmm(min % 1440)}`, tz)
