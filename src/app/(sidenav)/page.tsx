import { WidgetDefaultLayout } from '@/components/dashboard/widget-define'
import { getServerSession } from '@/lib/auth'
import { getString } from '@/lib/kvs'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { DashboardLayout, scDashboardLayout } from '@/lib/schema'
import { type Metadata } from 'next'
import { FC } from 'react'
import { HomeClient } from './client'

export const metadata: Metadata = {
  title: 'Home',
}

/**
 * 個人レイアウト未設定ユーザー向けのデフォルトレイアウトを解決する。
 * 管理者が設定した既定値(KVS) → ハードコードされた既定値 の順でフォールバックする。
 */
const resolveDefaultLayout = async (): Promise<DashboardLayout> => {
  const record = await getString('DASHBOARD_DEFAULT_LAYOUT')
  if (record?.value) {
    const parsed = scDashboardLayout.safeParse(JSON.parse(record.value))
    if (parsed.success) {
      return parsed.data
    }
    logger.warn({ value: record.value }, 'invalid default dashboard layout, fallback to default')
  }
  return WidgetDefaultLayout
}

const Home: FC = async () => {
  const session = await getServerSession()
  if (!session?.user) {
    return <></>
  }

  const res = await prisma.dashboard.findUnique({ where: { userId: session.user.id }, select: { layout: true } })
  logger.debug(res, 'dashboard.layout')

  const layout = (res?.layout as DashboardLayout) ?? (await resolveDefaultLayout())

  return <HomeClient layout={layout} />
}
export default Home
