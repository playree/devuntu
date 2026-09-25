import { getServerSession } from '@/lib/auth/auth'
import { resolveDefaultDashboardLayout } from '@/lib/dashboard-layout'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { DashboardLayout } from '@/lib/schema/schema-dashboard'
import { type Metadata } from 'next'
import { FC } from 'react'
import { HomeClient } from './client'

export const metadata: Metadata = {
  title: 'Home',
}

const Home: FC = async () => {
  const session = await getServerSession()
  if (!session?.user) {
    return <></>
  }

  const res = await prisma.dashboard.findUnique({ where: { userId: session.user.id }, select: { layout: true } })
  logger.debug(res, 'dashboard.layout')

  const layout = (res?.layout as DashboardLayout) ?? (await resolveDefaultDashboardLayout())

  return <HomeClient layout={layout} />
}
export default Home
