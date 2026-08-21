import type { Dayjs } from 'dayjs'
import { addDaysDateOnly, DEFAULT_TZ, zonedMinutes } from '../day'
import type { BusySlot } from './google-calendar'

/** 追加Busy時間の1件分(曜日+時間帯)。分は 0:00 からの分 */
export type BusyTimeRule = { weekdays: number[]; startMin: number; endMin: number }

/**
 * 週内の各日について、ルールの weekdays に該当する曜日の時間帯を
 * 絶対時刻の BusySlot(ISO文字列)へ展開する。
 *
 * weekStart は所有者タイムゾーンの週初日 0:00(Dayjs)。曜日判定は dayjs の .day()
 * (0=日 .. 6=土)で行う。
 *
 * 「毎週 9:00-18:00」は壁時計時刻の指定なので、日付は暦日で進めて時刻は tz で解決する
 * (絶対時間の加算にすると DST の切替日で 1 時間ずれる)。
 */
export const expandBusyTimes = (rules: BusyTimeRule[], weekStart: Dayjs, tz: string = DEFAULT_TZ): BusySlot[] => {
  const firstDate = weekStart.format('YYYY-MM-DD')

  const slots: BusySlot[] = []
  for (let di = 0; di < 7; di++) {
    // 日送りは DST の影響を受けない暦日で行う
    const date = addDaysDateOnly(firstDate, di)
    const weekday = zonedMinutes(date, 0, tz).day()
    for (const rule of rules) {
      if (!rule.weekdays.includes(weekday)) {
        continue
      }
      slots.push({
        start: zonedMinutes(date, rule.startMin, tz).toISOString(),
        end: zonedMinutes(date, rule.endMin, tz).toISOString(),
      })
    }
  }
  return slots
}

/**
 * 重なり・隣接する BusySlot を1つに統合し、非重複の区間配列へ正規化する。
 *
 * Google の busy と手動 Busy 時間を単純連結すると WeekView 上で半透明ブロックが
 * 二重に重なって表示されるため、区間としてマージして重なりを解消する。
 */
export const mergeBusySlots = (slots: BusySlot[]): BusySlot[] => {
  const sorted = slots
    .map((s) => ({ start: new Date(s.start).getTime(), end: new Date(s.end).getTime() }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start)

  const merged: { start: number; end: number }[] = []
  for (const s of sorted) {
    const last = merged[merged.length - 1]
    // 重なり(end > start) だけでなく隣接(end === start) も1区間に結合する
    if (last && last.end >= s.start) {
      last.end = Math.max(last.end, s.end)
    } else {
      merged.push({ ...s })
    }
  }

  return merged.map((s) => ({ start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString() }))
}
