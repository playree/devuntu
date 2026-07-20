import { startOfWeek, weekRange } from '@/lib/day'
import { getGoogleFreeBusy } from '@/lib/google-calendar-server'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { type Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PublicCalClient } from './client'

export const metadata: Metadata = {
  title: 'Calendar',
  robots: { index: false, follow: false },
}

const PublicCalPage = async ({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ date?: string }>
}) => {
  const { id } = await params
  const { date } = await searchParams

  const share = await prisma.calendarShare.findUnique({
    where: { publicId: id },
    select: { userId: true },
  })
  if (!share) {
    // 無効化済み or 不正なURL
    notFound()
  }

  const weekStart = startOfWeek(date)
  const { timeMin, timeMax } = weekRange(weekStart)
  const busy = await getGoogleFreeBusy({ userId: share.userId, timeMin, timeMax })
  logger.debug({ userId: share.userId, timeMin, timeMax, busy }, 'fetching google freebusy')

  return <PublicCalClient weekStartISO={weekStart.toISOString()} busy={busy} />
}
export default PublicCalPage
