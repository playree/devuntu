import { getServerSession } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { DashboardLayout } from '@/lib/schema'
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

  return <HomeClient layout={res?.layout as DashboardLayout} />
}
export default Home
