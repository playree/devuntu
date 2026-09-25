'use client'

import { TableCellsIcon } from '@/components/icon'
import { statusBgClass } from '@/components/ticket/ticket-chip'
import type { TicketStatus } from '@/generated/prisma/enums'
import { useActionData } from '@/lib/action/action-client'
import { TICKET_STATUS_LOCALE, TICKET_STATUSES } from '@/lib/board/task'
import { useLocale } from '@/locale/client'
import Link from 'next/link'
import { FC, ReactNode } from 'react'
import { getTicketSummary } from '../server'
import { WidgetDataCard, WidgetFC } from './widget-card'

/** 編集モード中はドラッグ操作と衝突しないよう遷移させない */
const Tile: FC<{ status: TicketStatus; href: string; editable: boolean; children: ReactNode }> = ({
  status,
  href,
  editable,
  children,
}) => {
  const className = statusBgClass(status, 'flex flex-col items-center gap-1 rounded-xl px-2 py-3 hover:opacity-80')
  if (editable) {
    return <div className={className}>{children}</div>
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  )
}

/**
 * 自分が担当するチケットのステータス別件数をタイルで表示する Widget。完了は直近 7 日に完了したものを数える。
 */
export const TicketSummaryWidget: WidgetFC = ({ id, editable }) => {
  const { t } = useLocale()
  const { data, isLoading } = useActionData(getTicketSummary)

  return (
    <WidgetDataCard
      id={id}
      editable={editable}
      icon={<TableCellsIcon />}
      title={t('ticket_summary')}
      data={data}
      isLoading={isLoading}
    >
      {(data) => (
        <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
          {TICKET_STATUSES.map((status) => (
            <Tile
              key={status}
              status={status}
              href={`/tickets?status=${status}&assignee=${data.selfUserId}`}
              editable={editable}
            >
              <span className='text-2xl font-bold'>{data.counts[status]}</span>
              <span className='text-center text-xs text-gray-500'>
                {status === 'done' ? t('status_done_recent') : t(TICKET_STATUS_LOCALE[status])}
              </span>
            </Tile>
          ))}
        </div>
      )}
    </WidgetDataCard>
  )
}
