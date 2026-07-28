'use client'

import type { TicketPriority, TicketStatus } from '@/generated/prisma/enums'
import { LocaleItemBase } from '@/locale'
import { useLocale } from '@/locale/client'
import { Chip, ChipProps } from '@heroui/react'
import { FC } from 'react'

type ChipColor = ChipProps['color']

/** ステータスのロケールキーと表示色 */
const STATUS_STYLE: Record<TicketStatus, { item: LocaleItemBase; color: ChipColor }> = {
  backlog: { item: 'status_backlog', color: 'default' },
  todo: { item: 'status_todo', color: 'accent' },
  doing: { item: 'status_doing', color: 'warning' },
  done: { item: 'status_done', color: 'success' },
}

/** 優先度のロケールキーと表示色 */
const PRIORITY_STYLE: Record<TicketPriority, { item: LocaleItemBase; color: ChipColor }> = {
  urgent: { item: 'priority_urgent', color: 'danger' },
  high: { item: 'priority_high', color: 'warning' },
  medium: { item: 'priority_medium', color: 'accent' },
  low: { item: 'priority_low', color: 'default' },
}

export const StatusChip: FC<{ status: TicketStatus; size?: ChipProps['size'] }> = ({ status, size = 'sm' }) => {
  const { t } = useLocale()
  const { item, color } = STATUS_STYLE[status]
  return (
    <Chip variant='soft' color={color} size={size}>
      <Chip.Label>{t(item)}</Chip.Label>
    </Chip>
  )
}

export const PriorityChip: FC<{ priority?: TicketPriority | null; size?: ChipProps['size'] }> = ({
  priority,
  size = 'sm',
}) => {
  const { t } = useLocale()
  if (!priority) {
    return null
  }
  const { item, color } = PRIORITY_STYLE[priority]
  return (
    <Chip variant='soft' color={color} size={size}>
      <Chip.Label>{t(item)}</Chip.Label>
    </Chip>
  )
}

export const TagChips: FC<{ tags: string[]; size?: ChipProps['size'] }> = ({ tags, size = 'sm' }) => {
  if (tags.length === 0) {
    return null
  }
  return (
    <div className='flex flex-wrap gap-1'>
      {tags.map((tag) => (
        <Chip key={tag} variant='tertiary' size={size}>
          <Chip.Label>{tag}</Chip.Label>
        </Chip>
      ))}
    </div>
  )
}

/** ステータス / 優先度の選択肢(Record<id, label>)。SingleSelectCtrl へ渡す */
export const useTicketOptions = () => {
  const { t } = useLocale()
  return {
    statusOptions: Object.fromEntries(
      (Object.keys(STATUS_STYLE) as TicketStatus[]).map((status) => [status, t(STATUS_STYLE[status].item)]),
    ),
    priorityOptions: Object.fromEntries(
      (Object.keys(PRIORITY_STYLE) as TicketPriority[]).map((priority) => [priority, t(PRIORITY_STYLE[priority].item)]),
    ),
  }
}
