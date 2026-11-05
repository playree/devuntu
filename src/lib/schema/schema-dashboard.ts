/**
 * ダッシュボード(レイアウト / お知らせ / リンクウィジェット)の入力スキーマ
 */

import { z } from 'zod'
import { zDescription, zImageFile, zName } from './schema'

/**
 * 1列の枠数の上限。既定レイアウトは各列10枠なので、保存済みの値を弾かない程度に余裕を持たせる。
 * 上限が無いと巨大な配列を保存でき、その全量がログにも出る
 */
export const DASHBOARD_COLUMN_MAX = 50
/** ウィジェットIDの長さの上限。最長は `link:<uuidv7>`(41文字) */
export const DASHBOARD_WIDGET_ID_MAX = 100

const zDashboardColumn = z.array(z.string().max(DASHBOARD_WIDGET_ID_MAX).nullable()).max(DASHBOARD_COLUMN_MAX)

export const scDashboardLayout = z.object({
  left: zDashboardColumn,
  right: zDashboardColumn,
})
export type DashboardLayout = z.infer<typeof scDashboardLayout>

export const scUpdateDashboard = z.object({
  layout: scDashboardLayout,
})

export const scUpdateAnnouncement = z.object({
  body: z.string(),
})
export type UpdateAnnouncement = z.infer<typeof scUpdateAnnouncement>

/** 全員のダッシュボードにリンクとして出すので、http(s) 以外(javascript: など)は受け付けない */
const zLinkUrl = z.url({ protocol: /^https?$/ })

export const scCreateLinkWidget = z.object({
  name: zName,
  url: zLinkUrl,
  description: zDescription,
  icon: zImageFile.optional(),
})
export type CreateLinkWidget = z.infer<typeof scCreateLinkWidget>

export const scUpdateLinkWidget = z.object({
  id: z.uuidv7(),
  name: zName,
  url: zLinkUrl,
  description: zDescription,
  icon: zImageFile.nullish(), // File | null | undefined
})
export type UpdateLinkWidget = z.infer<typeof scUpdateLinkWidget>
