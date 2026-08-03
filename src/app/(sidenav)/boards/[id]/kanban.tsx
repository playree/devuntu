'use client'

import { MultiButton } from '@/components/general/button'
import { ChatBubbleIcon, PlusIcon } from '@/components/icon'
import {
  PriorityBar,
  priorityBgClass,
  priorityBorderClass,
  PriorityChip,
  StatusChip,
  TagChips,
} from '@/components/ticket/ticket-chip'
import type { TicketStatus } from '@/generated/prisma/enums'
import { dayformat } from '@/lib/day'
import { cardDropId, KANBAN_LANES, laneDropId } from '@/lib/task'
import { useLocale } from '@/locale/client'
import { KeyboardSensor, PointerSensor, useDraggable, useDroppable } from '@dnd-kit/react'
import { Checkbox, Chip, cn } from '@heroui/react'
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

/**
 * カード用のセンサー。data-no-drag を付けた要素の上ではドラッグを開始しない。
 *
 * dnd-kit の既定 preventActivation は target.closest('input, button, a[href], ...') で
 * interactive 要素上のドラッグ開始を防いでいる(タイトルの Link がドラッグにならないのはこれ)。
 * ところが HeroUI の Checkbox は input を「子孫」に持つ構造なので closest では拾えず、
 * 選択チェックボックスの長押しでカードのドラッグが始まってしまう。
 * そこで data-no-drag を判定に足し、既定の判定はそのまま呼んで維持する。
 *
 * なお pointerdown の伝播をネイティブに止める方法は使えない。
 * React はイベントをルートコンテナで受けて合成イベントを配送するため、
 * 途中で止めると dnd-kit だけでなく Checkbox 自身の押下判定にも届かなくなる。
 *
 * useDraggable の sensors は manager の既定センサーを置き換えるので、
 * キーボード操作を残すため KeyboardSensor も並べておく。
 * 配列は毎レンダー作り直すとセンサーの再バインドが走るのでモジュールスコープで持つ。
 */
const CARD_SENSORS = [
  PointerSensor.configure({
    preventActivation: (event, source) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-no-drag]')) {
        return true
      }
      return PointerSensor.defaults.preventActivation?.(event, source) ?? false
    },
  }),
  KeyboardSensor,
]

/** カード 1 枚。レーン移動は DnD、それ以外の変更は選択して詳細パネルから行う */
const KanbanCardView: FC<{
  card: KanbanCard
  isSelected: boolean
  onSelect: (selected: boolean) => void
}> = ({ card, isSelected, onSelect }) => {
  const { ref: dropRef, isDropTarget } = useDroppable({ id: cardDropId(card.id), accept: DRAG_TYPE })
  const { ref: dragRef, isDragging } = useDraggable({ id: card.id, type: DRAG_TYPE, sensors: CARD_SENSORS })

  return (
    <div // 外側 = ドロップ枠。ドラッグ中も矩形が元位置に留まるので挿入位置の基準が安定する
      ref={dropRef}
      className={cn(
        'rounded-xl',
        // ドラッグ中の挿入位置の方が情報として重要なので、ドロップ対象の枠を選択の枠より優先する
        isDropTarget ? 'ring-2 ring-blue-300' : isSelected ? 'ring-2 ring-blue-500' : '',
      )}
    >
      <div // ref を1要素へまとめるとインライン合成で毎レンダー detach/attach が走るため入れ子にする
        ref={dragRef}
        className={cn(
          /**
           * 優先度バーを角丸に沿って左右いっぱいに出すため、padding は内側の div に持たせて overflow-hidden で切る。
           * panel.tsx と違い dark:border-t-2 を持たないのは、上端はバーが輪郭を兼ねるため。
           * 代わりにダークでは priorityBorderClass がバーと同色の枠を全周に出す。
           */
          'cursor-pointer overflow-hidden rounded-xl',
          'shadow-md dark:shadow-none', // ダークは枠線が輪郭を作るので影は要らない
          priorityBgClass(card.priority),
          priorityBorderClass(card.priority),
          isDragging ? 'opacity-60' : '',
        )}
      >
        <PriorityBar priority={card.priority} />

        <div className='space-y-1 p-2'>
          <div className='flex items-start gap-1'>
            <span // 選択用のチェックボックス。この上ではドラッグを開始させない(CARD_SENSORS 参照)
              data-no-drag
              className='shrink-0'
            >
              <Checkbox aria-label='select ticket' variant='secondary' isSelected={isSelected} onChange={onSelect}>
                <Checkbox.Content>
                  <Checkbox.Control className='size-5'>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                </Checkbox.Content>
              </Checkbox>
            </span>

            <p // 空白のない長いタイトルでもレーン幅を超えないよう wrap-anywhere で任意位置折り返しにする
              className='line-clamp-2 min-w-0 flex-1 text-sm wrap-anywhere'
            >
              <Link // line-clamp は display:-webkit-box なので Link 側に持たせると行全体がリンク範囲になる。外側の p に寄せて Link はインラインのまま文字列だけを範囲にする
                href={`/tickets/${card.id}`}
                className='hover:underline'
              >
                {card.title}
              </Link>
            </p>
          </div>

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
        </div>
      </div>
    </div>
  )
}

/** レーン 1 列。空でもドロップできるよう min-h を必ず与える */
export const KanbanLane: FC<{
  status: TicketStatus
  cards: KanbanCard[]
  /** 詳細パネルに表示中のチケット。未選択なら undefined */
  selectedId?: string
  onAdd: () => void
  onSelect: (ticketId: string, selected: boolean) => void
}> = ({ status, cards, selectedId, onAdd, onSelect }) => {
  const { t } = useLocale()
  const { className, cardsClassName } = LANE_LAYOUT[status]
  const { ref, isDropTarget } = useDroppable({ id: laneDropId(status), accept: DRAG_TYPE })

  return (
    <fieldset // 既定で min-inline-size: min-content のため、min-w-0 が無いとカード内容の分だけ横に広がる
      ref={ref}
      className={cn('min-w-0 rounded-xl border-2 p-2', isDropTarget ? 'border-blue-300' : '', className)}
    >
      <legend className='flex items-center gap-1 px-2'>
        <StatusChip status={status} />
        <span className='font-mono text-xs text-gray-500'>{cards.length}</span>
        {status !== 'done' && (
          <MultiButton // 完了レーンは新規チケットの起点にならないため追加ボタンを出さない
            isIconOnly
            variant='outline'
            tooltip={t('add_ticket')}
            isSmart
            onPress={onAdd}
          >
            <PlusIcon width={16} />
          </MultiButton>
        )}
      </legend>

      <div className={cn('min-h-16 space-y-2', cardsClassName)}>
        {cards.map((card) => (
          <KanbanCardView
            key={card.id}
            card={card}
            isSelected={card.id === selectedId}
            onSelect={(selected) => onSelect(card.id, selected)}
          />
        ))}
        {cards.length === 0 && <p className='p-2 text-xs text-gray-500'>{t('msg_no_tickets')}</p>}
      </div>
    </fieldset>
  )
}
