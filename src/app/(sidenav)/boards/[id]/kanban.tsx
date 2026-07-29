'use client'

import { MultiButton } from '@/components/general/button'
import { ChatBubbleIcon, PlusIcon } from '@/components/icon'
import { PriorityChip, StatusChip, TagChips, useTicketOptions } from '@/components/ticket/ticket-chip'
import type { TicketStatus } from '@/generated/prisma/enums'
import { dayformat } from '@/lib/day'
import { cardDropId, KANBAN_LANES, laneDropId } from '@/lib/task'
import { useLocale } from '@/locale/client'
import { useDraggable, useDroppable } from '@dnd-kit/react'
import { Chip, cn, Label, ListBox, Select } from '@heroui/react'
import Link from 'next/link'
import { FC } from 'react'
import { GetBoardKanbanReturnType } from './server'

type Kanban = NonNullable<GetBoardKanbanReturnType>
export type KanbanCard = Kanban['lanes']['todo'][number]

/** DnD の type。カード以外のドラッグと混ざらないようにする */
const DRAG_TYPE = 'ticket'

/**
 * レーンの配置。todo/doing/done を横3列、その下に backlog を全幅で置く。
 * Tailwind のスキャン対象になるようクラス名は完全なリテラルで書くこと。
 */
export const LANE_LAYOUT: Record<TicketStatus, { className: string; cardsClassName?: string }> = {
  todo: { className: 'col-span-12 md:col-span-4' },
  doing: { className: 'col-span-12 md:col-span-4' },
  done: { className: 'col-span-12 md:col-span-4' },
  backlog: { className: 'col-span-12', cardsClassName: 'md:grid md:grid-cols-3 md:gap-2 md:space-y-0' },
}

/** かんばんのレーン表示順(横3列 + backlog) */
export const LANE_ORDER = KANBAN_LANES

/** カード 1 枚。ステータス変更は DnD と Select の両方から同じ move() を呼ぶ */
const KanbanCardView: FC<{
  card: KanbanCard
  onChangeStatus: (status: TicketStatus) => void
}> = ({ card, onChangeStatus }) => {
  const { t } = useLocale()
  const { statusOptions } = useTicketOptions()
  const { ref: dropRef, isDropTarget } = useDroppable({ id: cardDropId(card.id), accept: DRAG_TYPE })
  const { ref: dragRef, isDragging } = useDraggable({ id: card.id, type: DRAG_TYPE })

  return (
    // 外側 = ドロップ枠。ドラッグ中も矩形が元位置に留まるので挿入位置の基準が安定する
    <div ref={dropRef} className={cn('rounded-xl', isDropTarget ? 'ring-2 ring-blue-300' : '')}>
      {/* ref を1要素へまとめるとインライン合成で毎レンダー detach/attach が走るため入れ子にする */}
      <div
        ref={dragRef}
        className={cn('cursor-grab space-y-1 rounded-xl border-2 p-2', isDragging ? 'opacity-60' : '')}
      >
        <Link href={`/tickets/${card.id}`} className='line-clamp-2 text-sm hover:underline'>
          {card.title}
        </Link>

        <div className='flex flex-wrap items-center gap-1'>
          <PriorityChip priority={card.priority} />
          {card.assigneeName && (
            <Chip variant='tertiary' size='sm'>
              <Chip.Label>{card.assigneeName}</Chip.Label>
            </Chip>
          )}
          {card.dueDate && <span className='font-mono text-xs'>{dayformat(card.dueDate, 'date')}</span>}
          {card.commentCount > 0 && (
            <span className='flex items-center gap-0.5 text-xs text-gray-500'>
              <ChatBubbleIcon width={12} />
              {card.commentCount}
            </span>
          )}
        </div>

        <TagChips tags={card.tags} />

        {/* DnD が使えないタッチ環境向けのフォールバック(button/select 上ではドラッグが開始しない) */}
        <Select
          selectionMode='single'
          variant='secondary'
          value={card.status}
          onChange={(key) => {
            const next = key?.toString() as TicketStatus | undefined
            if (next && next !== card.status) {
              onChangeStatus(next)
            }
          }}
        >
          <Label className='sr-only'>{t('status')}</Label>
          <Select.Trigger className='min-h-7 py-1'>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox selectionMode='single'>
              {LANE_ORDER.map((status) => (
                <ListBox.Item key={status} id={status} textValue={statusOptions[status]}>
                  {statusOptions[status]}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>
    </div>
  )
}

/** レーン 1 列。空でもドロップできるよう min-h を必ず与える */
export const KanbanLane: FC<{
  status: TicketStatus
  cards: KanbanCard[]
  onAdd: () => void
  onChangeStatus: (card: KanbanCard, status: TicketStatus) => void
}> = ({ status, cards, onAdd, onChangeStatus }) => {
  const { t } = useLocale()
  const { className, cardsClassName } = LANE_LAYOUT[status]
  const { ref, isDropTarget } = useDroppable({ id: laneDropId(status), accept: DRAG_TYPE })

  return (
    <fieldset ref={ref} className={cn('rounded-xl border-2 p-2', isDropTarget ? 'border-blue-300' : '', className)}>
      <legend className='flex items-center gap-1 px-2'>
        <StatusChip status={status} />
        <span className='font-mono text-xs text-gray-500'>{cards.length}</span>
        <MultiButton isIconOnly variant='tertiary' tooltip={t('add_ticket')} isSmart onPress={onAdd}>
          <PlusIcon width={16} />
        </MultiButton>
      </legend>

      <div className={cn('min-h-16 space-y-2', cardsClassName)}>
        {cards.map((card) => (
          <KanbanCardView key={card.id} card={card} onChangeStatus={(next) => onChangeStatus(card, next)} />
        ))}
        {cards.length === 0 && <p className='p-2 text-xs text-gray-500'>{t('msg_no_tickets')}</p>}
      </div>
    </fieldset>
  )
}
