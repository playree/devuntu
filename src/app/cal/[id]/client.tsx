'use client'

import { WeekView } from '@/components/calendar/week-view'
import { MultiButton } from '@/components/general/button'
import { ThemeSwitchList } from '@/components/general/theme-switch'
import { ArrowLeftCircleIcon, ArrowRightCircleIcon, CalendarDaysIcon } from '@/components/icon'
import { LocaleSwitch } from '@/components/locale/locale-switch'
import { makePath } from '@/lib/client-utils'
import { toZone } from '@/lib/day'
import type { BusySlot } from '@/lib/google-calendar'
import { useLocale } from '@/locale/client'
import { cn } from '@heroui/react'
import { usePathname, useRouter } from 'next/navigation'
import { FC } from 'react'

export const PublicCalClient: FC<{ weekStartISO: string; busy: BusySlot[] | null; timezone: string }> = ({
  weekStartISO,
  busy,
  timezone,
}) => {
  const { t } = useLocale()
  const router = useRouter()
  const pathname = usePathname()

  const weekStart = toZone(weekStartISO, timezone)
  const weekLabel = `${weekStart.format('YYYY/M/D')} - ${weekStart.add(6, 'day').format('M/D')}`

  const go = (deltaDays: number) => {
    const target = weekStart.add(deltaDays, 'day').format('YYYY-MM-DD')
    router.push(makePath(pathname, { date: target }))
  }

  return (
    <div className='relative min-h-screen w-full'>
      {/* サインインページ(SingleLayout)と同じグリッド背景 */}
      <div
        className={cn(
          'absolute inset-0 bg-size-[20px_20px]',
          'bg-[linear-gradient(to_right,#80808030_1px,transparent_1px),linear-gradient(to_bottom,#80808030_1px,transparent_1px)]',
          'mask-[radial-gradient(ellipse_80%_50%_at_50%_50%,#000_10%,transparent_100%)]',
        )}
      ></div>

      <div className='relative mx-auto flex w-full max-w-5xl flex-col gap-3 p-3'>
        <div className='flex flex-wrap items-center gap-2'>
          <div className='flex items-center gap-2 text-lg font-semibold'>
            <CalendarDaysIcon />
            {t('calendar')}
          </div>
          <div className='flex flex-auto justify-end gap-2'>
            <ThemeSwitchList size='sm' />
            <LocaleSwitch size='sm' />
          </div>
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          <MultiButton isSmart variant='outline' icon={<ArrowLeftCircleIcon />} onPress={() => go(-7)}>
            {t('prev_week')}
          </MultiButton>
          <MultiButton isSmart variant='outline' onPress={() => router.push(pathname)}>
            {t('today')}
          </MultiButton>
          <MultiButton isSmart variant='outline' icon={<ArrowRightCircleIcon />} onPress={() => go(7)}>
            {t('next_week')}
          </MultiButton>
          <div className='text-sm font-medium text-neutral-500'>{weekLabel}</div>
        </div>

        {busy === null ? (
          <div className='rounded-xl border border-neutral-200 p-8 text-center text-sm text-neutral-500 dark:border-neutral-800'>
            {t('msg_calendar_share_unavailable')}
          </div>
        ) : (
          <WeekView weekStartISO={weekStartISO} busy={busy} timezone={timezone} />
        )}
      </div>
    </div>
  )
}
