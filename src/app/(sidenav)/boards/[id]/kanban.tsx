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
 * カードの高さを一杯まで使うレーン(todo/doing/done)のカード領域。
 *
 * 高さは client.tsx 側の chain(ルートを画面高で固定 → Grid が flex-1 → 1行目が minmax(0,1fr))で降りてくる。
 * overflow-y-auto を持つ flex 子は automatic minimum size が 0 になるため min-h-0 は要らない
 * (min-h-16 は空レーンのドロップ枠として残す。min-h-0 を足すと同じ min-height の指定同士で競合する)。
 * p-0.5 と相殺の -m-0.5 は、選択 / ドロップ対象カードの ring-2 がスクロール領域の境界で切れるのを防ぐため。
 */
const SCROLL_CARDS_CLASS = 'md:-m-0.5 md:flex-1 md:overflow-y-auto md:p-0.5'

/**
 * backlog のカード領域の高さ上限。カード2行分で頭打ちにして、残りはレーン内でスクロールさせる。
 *
 * カードの高さは中身で変わる(実測: 最小 = タイトル1行 + 優先度 chip のみで約 4.45rem、
 * 担当者 / 期日 / タグまで付くと約 5.95rem、タイトル2行だと約 7.25rem)ため、
 * 「ちょうど2行」を CSS だけで表すことはできない。
 * そこで担当者・期日付きのカード 2 行分 + gap 0.5rem ≒ 12.5rem を上限にする。
 * 最小のカードでも 3 行(約 14.35rem)は収まらないので、3 行目以降は必ずスクロールになる。
 */
const BACKLOG_MAX_H_CLASS = 'md:max-h-[12.5rem]'

/**
 * レーンの配置。todo/doing/done を横3列、その下に backlog を全幅で置く。
 * Tailwind のスキャン対象になるようクラス名は完全なリテラルで書くこと。
 */
export const LANE_LAYOUT: Record<TicketStatus, { className: string; cardsClassName?: string }> = {
  todo: { className: 'col-span-12 md:col-span-4', cardsClassName: SCROLL_CARDS_CLASS },
  doing: { className: 'col-span-12 md:col-span-4', cardsClassName: SCROLL_CARDS_CLASS },
  done: { className: 'col-span-12 md:col-span-4', cardsClassName: SCROLL_CARDS_CLASS },
  backlog: {
    className: 'col-span-12',
    cardsClassName: cn(
      'md:grid md:grid-cols-3 md:gap-2 md:space-y-0',
      BACKLOG_MAX_H_CLASS,
      'md:-m-0.5 md:overflow-y-auto md:p-0.5',
    ),
  },
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
           * PriorityBar は自前で余白(mt / mx)を持つので、padding は兄弟の内容 div 側に寄せる。
           * panel.tsx と違い dark:border-t-2 を持たないのは、上端は PriorityBar の線が輪郭を兼ねるため。
           * 代わりにダークでは priorityBorderClass が線と同系色の枠を全周に出す。
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
                  <Checkbox.Control // HeroUI v3 に radius prop が無いため className で丸型化。選択時の塗り(::before)も別途 rounded-md を持つので before: でも上書きする
                    className='size-5 rounded-full before:rounded-full'
                  >
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
    <fieldset
      /**
       * 既定で min-inline-size: min-content のため、min-w-0 が無いとカード内容の分だけ横に広がる。
       *
       * md 以上では内側のカード領域をスクロールさせるので flex コンテナにする。
       * grid item の block 方向 automatic minimum size を min-h-0 で切らないと、
       * 行が縮んだときに内容の高さのまま溢れてスクロール領域へ高さが渡らない。
       * なお fieldset を flex にしても legend は flex item にならず従来どおり枠線上に描画される。
       */
      ref={ref}
      className={cn(
        'min-w-0 rounded-xl border-2 p-2 md:flex md:min-h-0 md:flex-col',
        isDropTarget ? 'border-blue-300' : '',
        className,
      )}
    >
      <legend className='flex items-center gap-1 px-2'>
        <StatusChip status={status} />
        <span className='font-mono text-xs text-gray-500'>{cards.length}</span>
        {status !== 'done' && (
          <MultiButton // 完了レーンは新規チケットの起点にならないため追加ボタンを出さない
            isIconOnly
            size='sm'
            variant='outline'
            tooltip={t('add_ticket')}
            isSmart
            /**
             * isSmart の px-2 py-0.5 だとアイコン幅に対して大きいため詰める。
             * isIconOnly の min-w も効くので min-w-0 で解除する
             */
            className='min-w-0 px-0.5 py-0'
            onPress={onAdd}
          >
            <PlusIcon width={12} />
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
