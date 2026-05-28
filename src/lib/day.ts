import dayjs, { Dayjs, extend } from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

extend(utc)
extend(timezone)

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
