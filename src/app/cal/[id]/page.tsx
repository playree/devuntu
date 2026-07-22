import { startOfWeek, weekRange } from '@/lib/day'
import { envu } from '@/lib/env-util'
import { getGoogleFreeBusy } from '@/lib/google-calendar-server'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { scCalendarShareOptions } from '@/lib/schema'
import { type Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PublicCalClient } from './client'

export const generateMetadata = async ({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> => {
  const { id } = await params
  const share = await prisma.calendarShare.findUnique({
    where: { publicId: id },
    select: { options: true },
  })
  const title = scCalendarShareOptions.safeParse(share?.options).data?.title ?? ''
  return {
    title: { absolute: title || 'Calendar' },
    robots: { index: false, follow: false },
  }
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
    select: { userId: true, options: true, user: { select: { timezone: true } } },
  })
  if (!share) {
    // 無効化済み or 不正なURL
    notFound()
  }

  // 所有者(カレンダー主)のタイムゾーンで表示を固定する
  const tz = share.user.timezone ?? envu.server.DEFAULT_TIMEZONE
  const title = scCalendarShareOptions.safeParse(share.options).data?.title ?? ''

  const weekStart = startOfWeek(date, tz)
  const { timeMin, timeMax } = weekRange(weekStart)
  const busy = await getGoogleFreeBusy({ userId: share.userId, timeMin, timeMax, timeZone: tz })
  logger.debug({ userId: share.userId, timeMin, timeMax, tz, busy }, 'fetching google freebusy')

  return <PublicCalClient weekStartISO={weekStart.toISOString()} busy={busy} timezone={tz} title={title} />
}
export default PublicCalPage
