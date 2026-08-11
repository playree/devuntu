import { cached } from '@/lib/cache'
import { expandBusyTimes, mergeBusySlots } from '@/lib/calendar-busy'
import { startOfWeek, weekRange } from '@/lib/day'
import { envu } from '@/lib/env-util'
import { getGoogleFreeBusy } from '@/lib/google-calendar-server'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { scCalendarShareOptions } from '@/lib/schema'
import { type Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PublicCalClient } from './client'

/** 公開カレンダーの空き時間をキャッシュする時間。表示の鮮度と API 呼び出し回数の折り合い */
const PUBLIC_CAL_TTL_MS = 5 * 60 * 1000

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
  const { timeMin, timeMax } = weekRange(weekStart, tz)

  /**
   * 共有URLを知っていれば誰でも開けるページなので、週ごとの結果をキャッシュして
   * 匿名リクエストの数だけ Google API を呼ばないようにする(共有の無効化は share の参照で即時反映される)。
   */
  const merged = await cached(`public-cal:${share.userId}:${tz}:${timeMin}`, PUBLIC_CAL_TTL_MS, async () => {
    const busy = await getGoogleFreeBusy({ userId: share.userId, timeMin, timeMax, timeZone: tz })
    logger.debug({ userId: share.userId, timeMin, timeMax, tz, busy }, 'fetching google freebusy')
    if (busy === null) {
      return null
    }

    // Google の busy が取得できたときのみ、手動で登録された追加Busy時間を展開して統合する
    const rules = await prisma.calendarBusyTime.findMany({
      where: { userId: share.userId },
      select: { weekdays: true, startMin: true, endMin: true },
    })
    return mergeBusySlots([...busy, ...expandBusyTimes(rules, weekStart, tz)])
  })

  return <PublicCalClient weekStartISO={weekStart.toISOString()} busy={merged} timezone={tz} title={title} />
}
export default PublicCalPage
