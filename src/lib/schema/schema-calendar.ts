/**
 * カレンダー(共有 / 追加Busy時間)の入力スキーマ
 */

import { el } from '@/locale'
import { z } from 'zod'

export const zShareTitle = z.string().trim().max(50) // 空文字許可(表示側でフォールバック)

/** CalendarShare.options の構造 */
export const scCalendarShareOptions = z.object({ title: z.string().max(50).optional() })
export type CalendarShareOptions = z.infer<typeof scCalendarShareOptions>

export const scUpdateCalendarShareTitle = z.object({ title: zShareTitle })
export type UpdateCalendarShareTitle = z.infer<typeof scUpdateCalendarShareTitle>

/** 追加Busy時間(件名+曜日+時間帯)。時間は 0:00 からの分(30分刻み)で扱う */
const zMin30 = z.number().int().multipleOf(30, el('@invalid_time_range'))
// InputCtrl の constraintSchema(z.ZodObject 前提)へ渡すため refine 前の base を分離
export const scBusyTimeBase = z.object({
  title: z.string().trim().min(1, el('@required_field')).max(50),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1, el('@select_weekday')),
  startMin: zMin30.min(0, el('@invalid_time_range')).max(1410, el('@invalid_time_range')),
  endMin: zMin30.min(30, el('@invalid_time_range')).max(1440, el('@invalid_time_range')),
})
export const scBusyTimeFields = scBusyTimeBase.refine((d) => d.startMin < d.endMin, {
  path: ['endMin'],
  message: el('@invalid_time_range'),
})

export const scCreateBusyTime = scBusyTimeFields
export type CreateBusyTime = z.infer<typeof scCreateBusyTime>

export const scUpdateBusyTime = z.object({ id: z.uuidv7() }).and(scBusyTimeFields)
export type UpdateBusyTime = z.infer<typeof scUpdateBusyTime>
