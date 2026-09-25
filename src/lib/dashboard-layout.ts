/**
 * ダッシュボードの既定レイアウト(サーバー専用)
 *
 * 管理者が KVS に保存した値は手で壊される(DB を直接編集する等)こともあるので、
 * 読めなければハードコードの既定値へ倒す。ホーム画面と管理画面で同じ判定を使う。
 */

import { WidgetDefaultLayout } from '@/components/dashboard/widget-define'
import { getString } from './kvs'
import { logger } from './logger'
import { type DashboardLayout, scDashboardLayout } from './schema/schema-dashboard'

const parseLayout = (value: string): DashboardLayout | null => {
  try {
    const parsed = scDashboardLayout.safeParse(JSON.parse(value))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** 個人レイアウト未設定ユーザー向けの既定。管理者の設定(KVS) → ハードコードの既定値 の順 */
export const resolveDefaultDashboardLayout = async (): Promise<DashboardLayout> => {
  const record = await getString('DASHBOARD_DEFAULT_LAYOUT')
  if (record?.value) {
    const layout = parseLayout(record.value)
    if (layout) {
      return layout
    }
    logger.warn({ value: record.value }, 'invalid default dashboard layout, fallback to default')
  }
  return WidgetDefaultLayout
}
