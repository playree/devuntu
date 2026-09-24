'use client'

import { ClockIcon, FireIcon } from '@/components/icon'
import { StatusChip, TicketIdText } from '@/components/ticket/ticket-chip'
import type { TicketStatus } from '@/generated/prisma/enums'
import { dayformat, isDateOnlyOverdue } from '@/lib/day'
import { useLocale } from '@/locale/client'
import Link from 'next/link'
import { FC, ReactNode } from 'react'
import { tv } from 'tailwind-variants'

export type WidgetTicket = {
  id: string
  displayId: string
  title: string
  status: TicketStatus
  dueDate: Date | null
}

/** クラス名は purge 対策で必ず完全なリテラルで書くこと(ticket-chip.tsx と同じ規約) */
const dueDateStyles = tv({
  base: 'flex shrink-0 items-center gap-0.5 text-xs',
  variants: {
    overdue: {
      true: 'text-danger',
      false: 'text-gray-500',
    },
  },
})

/** 期日。期限切れは色とアイコンで示す */
export const TicketDueDate: FC<{ dueDate: Date | null; tz: string }> = ({ dueDate, tz }) => {
  const { t } = useLocale()
  if (!dueDate) {
    return null
  }
  const overdue = isDateOnlyOverdue(dueDate, tz)
  return (
    <span className={dueDateStyles({ overdue })}>
      {overdue ? <FireIcon width={12} /> : <ClockIcon width={12} />}
      <span // 色だけで期限切れを伝えないよう、読み上げるラベルも差し替える
        className='sr-only'
      >
        {overdue ? t('overdue') : t('due_date')}
      </span>
      <span className='font-mono'>{dayformat(dueDate, 'date')}</span>
    </span>
  )
}

/** 編集モード中はドラッグ操作と衝突しないよう遷移させない */
const RowLink: FC<{ href: string; editable: boolean; children: ReactNode }> = ({ href, editable, children }) => {
  const className = 'flex flex-col gap-1 rounded-lg px-2 py-1.5 hover:bg-default/40'
  if (editable) {
    return <div className={className}>{children}</div>
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  )
}

/** チケット 1 件ぶんの行。狭い幅では件名を 1 行で省略し、ステータスと期日を下段に置く */
export const TicketRow: FC<{ ticket: WidgetTicket; tz: string; editable: boolean }> = ({ ticket, tz, editable }) => (
  <RowLink href={`/t/${ticket.displayId}`} editable={editable}>
    <div className='flex min-w-0 items-center gap-2'>
      <TicketIdText displayId={ticket.displayId} className='shrink-0' />
      <span className='truncate text-sm'>{ticket.title}</span>
    </div>
    <div className='flex items-center gap-2'>
      <StatusChip status={ticket.status} />
      <TicketDueDate dueDate={ticket.dueDate} tz={tz} />
    </div>
  </RowLink>
)

/** チケット行の一覧。0 件なら message を出す */
export const TicketRowList: FC<{ tickets: WidgetTicket[]; tz: string; editable: boolean; message: string }> = ({
  tickets,
  tz,
  editable,
  message,
}) => {
  if (tickets.length === 0) {
    return <div className='min-h-14 px-2 py-1 text-sm text-gray-500'>{message}</div>
  }
  return (
    <div className='flex max-h-96 min-h-14 flex-col overflow-y-auto'>
      {tickets.map((ticket) => (
        <TicketRow key={ticket.id} ticket={ticket} tz={tz} editable={editable} />
      ))}
    </div>
  )
}
