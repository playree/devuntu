'use client'

import { toZone, WEEKDAY_LABELS } from '@/lib/day'
import type { BusySlot } from '@/lib/google/google-calendar'
import { useLocale } from '@/locale/client'
import { cn } from '@heroui/react'
import dayjs from 'dayjs'
import { FC, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'

/** マウント済みか(クライアントのみ true)。SSR とのハイドレーション不一致を避けつつ現在時刻を扱う */
const emptySubscribe = () => () => {}
const useMounted = () =>
  useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  )

/** 1時間あたりの高さ(px) */
const HOUR_HEIGHT = 48
const TOTAL_HEIGHT = HOUR_HEIGHT * 24
const HOURS = Array.from({ length: 24 }, (_, i) => i)

type DayBlock = { top: number; height: number }

/**
 * Google カレンダー週表示風のグリッド。
 * FreeBusy(予定あり区間)のみをブロック表示し、予定のタイトル等は一切表示しない。
 */
export const WeekView: FC<{ weekStartISO: string; busy: BusySlot[]; timezone: string; className?: string }> = ({
  weekStartISO,
  busy,
  timezone,
  className,
}) => {
  const { locale } = useLocale()
  const weekdays = WEEKDAY_LABELS[locale] ?? WEEKDAY_LABELS.ja
  const scrollRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  // 現在時刻はクライアントでのみ確定する(SSR では null)
  const mounted = useMounted()
  const now = useMemo(() => (mounted ? dayjs().tz(timezone) : null), [mounted, timezone])
  const todayStr = now?.format('YYYY-MM-DD') ?? ''
  const nowY = now ? ((now.hour() * 60 + now.minute()) / (24 * 60)) * TOTAL_HEIGHT : null

  const weekStart = useMemo(() => toZone(weekStartISO, timezone), [weekStartISO, timezone])

  // 各日ごとの列情報(日付・当日判定・busyブロック位置)を算出
  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, di) => {
      const dayStart = weekStart.add(di, 'day')
      const dayStartMs = dayStart.valueOf()
      const dayEndMs = dayStart.add(1, 'day').valueOf()
      const dayMs = dayEndMs - dayStartMs

      const blocks: DayBlock[] = []
      for (const slot of busy) {
        const bs = new Date(slot.start).getTime()
        const be = new Date(slot.end).getTime()
        const s = Math.max(bs, dayStartMs)
        const e = Math.min(be, dayEndMs)
        if (e > s) {
          blocks.push({
            top: ((s - dayStartMs) / dayMs) * TOTAL_HEIGHT,
            height: ((e - s) / dayMs) * TOTAL_HEIGHT,
          })
        }
      }

      return {
        key: dayStart.format('YYYY-MM-DD'),
        weekdayIndex: dayStart.day(),
        dateLabel: dayStart.format('M/D'),
        blocks,
      }
    })
  }, [weekStart, busy])

  useEffect(() => {
    // 初期スクロール位置: 当週に今日が含まれれば現在時刻を中央に、なければ 8:00 付近を表示
    // sticky ヘッダの分だけ本文が下にずれるため、本文の offsetTop を加味する
    const container = scrollRef.current
    const body = bodyRef.current
    if (!container || !body || !now || nowY === null) {
      return
    }
    const bodyTop = body.offsetTop
    const inThisWeek = days.some((d) => d.key === todayStr)
    const target = inThisWeek ? bodyTop + nowY - container.clientHeight / 2 : bodyTop + 8 * HOUR_HEIGHT - HOUR_HEIGHT
    container.scrollTop = Math.max(0, target)
  }, [days, now, nowY, todayStr])

  return (
    <div
      className={cn(
        'bg-background overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800',
        className,
      )}
    >
      {/* ヘッダと本文を同一スクロールコンテナに入れ、ヘッダを sticky にすることで
          スクロールバー幅を両者で共有し、縦罫線のズレを防ぐ */}
      <div ref={scrollRef} className='relative overflow-y-auto' style={{ maxHeight: 640 }}>
        {/* ヘッダ(曜日・日付) */}
        <div
          className={cn(
            'sticky top-0 z-20 flex border-b border-neutral-200 dark:border-neutral-800',
            'bg-cyan-50 dark:bg-gray-950',
          )}
        >
          <div className='w-12 shrink-0' />
          {days.map((d) => {
            const isToday = !!todayStr && d.key === todayStr
            const isSunday = d.weekdayIndex === 0
            const isSaturday = d.weekdayIndex === 6
            return (
              <div
                key={d.key}
                className={cn(
                  'flex-1 border-l border-neutral-200 py-1 text-center dark:border-neutral-800',
                  isToday && 'bg-blue-500/10',
                )}
              >
                <div
                  className={cn(
                    'text-xs font-semibold',
                    isSunday && 'text-red-500',
                    isSaturday && 'text-blue-500',
                    !isSunday && !isSaturday && 'text-neutral-500',
                  )}
                >
                  {weekdays[d.weekdayIndex]}
                </div>
                <div className={cn('font-mono text-sm font-semibold', isToday && 'text-blue-600 dark:text-blue-400')}>
                  {d.dateLabel}
                </div>
              </div>
            )
          })}
        </div>

        {/* 本文 */}
        <div ref={bodyRef} className='flex bg-cyan-50 dark:bg-gray-950' style={{ height: TOTAL_HEIGHT }}>
          {/* 時刻ラベル */}
          <div className='relative w-12 shrink-0'>
            {HOURS.map((h) => (
              <div
                key={h}
                className='absolute right-1 -translate-y-1/2 font-mono text-xs text-neutral-500'
                style={{ top: h * HOUR_HEIGHT }}
              >
                {h > 0 ? `${h}:00` : ''}
              </div>
            ))}
          </div>

          {/* 日ごとの列 */}
          {days.map((d) => {
            const isToday = !!todayStr && d.key === todayStr
            return (
              <div key={d.key} className='relative flex-1 border-l border-neutral-200 dark:border-neutral-800'>
                {/* 時間の区切り線 */}
                {HOURS.map((h) => (
                  <div
                    key={h}
                    className='absolute inset-x-0 border-t border-neutral-200 dark:border-neutral-900'
                    style={{ top: h * HOUR_HEIGHT }}
                  />
                ))}

                {/* 予定ありブロック */}
                {d.blocks.map((b, i) => (
                  <div
                    key={i}
                    className='absolute inset-x-0.5 rounded-md border border-blue-500/30 bg-blue-500/20'
                    style={{
                      top: b.top,
                      height: Math.max(2, b.height),
                      backgroundImage:
                        'repeating-linear-gradient(45deg, rgb(59 130 246 / 0.45) 0, rgb(59 130 246 / 0.45) 2px, transparent 2px, transparent 7px)',
                    }}
                  />
                ))}

                {/* 現在時刻ライン(当日のみ) */}
                {isToday && nowY !== null && (
                  <div className='absolute inset-x-0 z-10' style={{ top: nowY }}>
                    <div className='relative border-t border-red-500'>
                      <div className='absolute -top-1 -left-1 h-2 w-2 rounded-full bg-red-500' />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
