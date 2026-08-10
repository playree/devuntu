'use client'

import { UserAvatar } from '@/components/general/avatar'
import { MultiButton } from '@/components/general/button'
import { ChatBubbleIcon, CheckBadgeIcon, ClockIcon, PlusIcon } from '@/components/icon'
import {
  CARD_BACKDROP_CLASS,
  PriorityBar,
  priorityBgClass,
  priorityBorderClass,
  PriorityChip,
  statusBgClass,
  StatusChip,
  TagChips,
} from '@/components/ticket/ticket-chip'
import type { TicketStatus } from '@/generated/prisma/enums'
import { dayformat } from '@/lib/day'
import { cardDropId, KANBAN_LANES, laneDropId } from '@/lib/task'
import { useLocale } from '@/locale/client'
import { KeyboardSensor, PointerSensor, useDraggable, useDroppable } from '@dnd-kit/react'
import { Checkbox, cn } from '@heroui/react'
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
 * 高さは client.tsx 側の chain(ルートの max-h → 溢れた分だけ Grid が縮む → 1行目 minmax(0,1fr))で降りてくる。
 * 盤面が画面に収まっているときは 1行目が max-content になるので、ここは内容ぶんの高さになりスクロールしない。
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
      /**
       * items-start が無いと grid 既定の stretch でカードの外枠(ドロップ枠)だけが行の最大高さまで伸び、
       * 中身なりの高さしか持たない色付きカードの下に CARD_BACKDROP_CLASS の下地が帯として露出する。
       */
      'md:grid md:grid-cols-3 md:items-start md:gap-2 md:space-y-0',
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

/**
 * 選択チェックボックスをカード左端の縦長ピルにするクラス。
 * HeroUI 既定の control は size-4 の角丸四角なので、幅だけ残して高さを h-full にし、
 * 角丸を rounded-full で上書きする(size-4 は tailwind-merge により h-full w-4 が後勝ちする)。
 * 選択時の塗り(::before)は別途 rounded-md を持つので before: でも上書きする。
 */
const SELECT_PILL_CLASS = 'h-full w-4 rounded-full before:rounded-full'

/** カード 1 枚。レーン移動は DnD、それ以外の変更は選択して詳細パネルから行う */
const KanbanCardView: FC<{
  card: KanbanCard
  /** 完了日時の表示に使うユーザーのタイムゾーン。カードごとにセッションを購読しないよう上から渡す */
  tz: string
  isSelected: boolean
  onSelect: (selected: boolean) => void
}> = ({ card, tz, isSelected, onSelect }) => {
  const { t } = useLocale()
  const { ref: dropRef, isDropTarget } = useDroppable({ id: cardDropId(card.id), accept: DRAG_TYPE })
  const { ref: dragRef, isDragging } = useDraggable({ id: card.id, type: DRAG_TYPE, sensors: CARD_SENSORS })

  return (
    <div // 外側 = ドロップ枠。ドラッグ中も矩形が元位置に留まるので挿入位置の基準が安定する
      ref={dropRef}
      className={cn(
        'rounded-xl',
        // 半透明のカード背景(priorityBgClass)がレーンの色と混色されないよう、最背面に不透明な下地を敷く
        CARD_BACKDROP_CLASS,
        // ドラッグ中の挿入位置の方が情報として重要なので、ドロップ対象の枠を選択の枠より優先する
        isDropTarget ? 'ring-2 ring-blue-300' : isSelected ? 'ring-2 ring-blue-500' : '',
      )}
    >
      <div // ref を1要素へまとめるとインライン合成で毎レンダー detach/attach が走るため入れ子にする
        ref={dragRef}
        className={cn(
          /**
           * flex-col は「カード両端まで通す PriorityBar」+「選択ピル / 内容の行」の縦 2 段。
           * PriorityBar は自前で余白(mt)を持つので、padding は下段の内容 div 側に寄せる。
           * 上端に dark:border-t-2 を持たないのは、上端は PriorityBar の線が輪郭を兼ねるため。
           * 代わりにダークでは priorityBorderClass が線と同系色の枠を全周に出す。
           */
          'flex cursor-pointer flex-col overflow-hidden rounded-xl',
          'shadow-md dark:shadow-none', // ダークは枠線が輪郭を作るので影は要らない
          priorityBgClass(card.priority),
          priorityBorderClass(card.priority),
          isDragging ? 'opacity-60' : '',
        )}
      >
        <PriorityBar priority={card.priority} />

        <div // 下段。既定の stretch で選択ピルが内容の高さいっぱいに伸びる
          className='flex'
        >
          <span // 選択用のチェックボックス。この上ではドラッグを開始させない(CARD_SENSORS 参照)
            data-no-drag
            /**
             * 左は PriorityBar(w-[94%] の中央寄せ)の左端に揃う 4px。
             * 0 にしないのは、親の rounded-xl + overflow-hidden でピルの上下角が削られるため。
             * 上下は PriorityBar の下端 / カード下端から 8px 逃がす。
             */
            className='flex shrink-0 py-2 pl-1'
          >
            <Checkbox
              /**
               * HeroUI の base(flex flex-col)/ content(inline-flex)を跨いで
               * control まで高さを通すため、両方に h-full を渡す。
               */
              className='h-full'
              aria-label='select ticket'
              isSelected={isSelected}
              onChange={onSelect}
            >
              <Checkbox.Content className='h-full'>
                <Checkbox.Control className={SELECT_PILL_CLASS}>
                  <Checkbox.Indicator />
                </Checkbox.Control>
              </Checkbox.Content>
            </Checkbox>
          </span>

          <div // min-w-0 が無いと、長いタイトルが flex の automatic minimum size でレーン幅を押し広げる
            className='min-w-0 flex-1 space-y-1 p-2'
          >
            <p // 空白のない長いタイトルでもレーン幅を超えないよう wrap-anywhere で任意位置折り返しにする
              className='line-clamp-2 text-sm wrap-anywhere'
            >
              <Link // line-clamp は display:-webkit-box なので Link 側に持たせると行全体がリンク範囲になる。外側の p に寄せて Link はインラインのまま文字列だけを範囲にする
                href={`/tickets/${card.id}`}
                className='hover:underline'
              >
                {card.title}
              </Link>
            </p>

            <div className='flex flex-wrap items-center gap-1'>
              <PriorityChip priority={card.priority} />
              {card.assigneeName && (
                <span className='flex min-w-0 items-center gap-0.5 text-xs text-gray-500'>
                  <UserAvatar name={card.assigneeName} image={card.assigneeImage} size='xs' />
                  <span className='truncate'>{card.assigneeName}</span>
                </span>
              )}
              {card.completedAt ? (
                <span // 完了したカードで見たいのは期日ではなく完了日時なので、両方は出さず置き換える
                  className='flex items-center gap-0.5 text-xs text-gray-500'
                >
                  <CheckBadgeIcon width={12} />
                  <span className='sr-only'>{t('completed_at')}</span>
                  <span className='font-mono'>{dayformat(card.completedAt, 'tz-minute', tz)}</span>
                </span>
              ) : (
                card.dueDate && (
                  <span className='flex items-center gap-0.5 text-xs text-gray-500'>
                    <ClockIcon width={12} />
                    <span className='sr-only'>{t('due_date')}</span>
                    <span className='font-mono'>{dayformat(card.dueDate, 'date')}</span>
                  </span>
                )
              )}
              {card.commentCount > 0 && (
                <span className='flex items-center gap-0.5 text-xs text-gray-500'>
                  <ChatBubbleIcon width={12} />
                  <span className='sr-only'>{t('comment')}</span>
                  {card.commentCount}
                </span>
              )}
            </div>

            <TagChips tags={card.tags} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** レーン 1 列。空でもドロップできるよう min-h を必ず与える */
export const KanbanLane: FC<{
  status: TicketStatus
  cards: KanbanCard[]
  tz: string
  /** 詳細パネルに表示中のチケット。未選択なら undefined */
  selectedId?: string
  onAdd: () => void
  onSelect: (ticketId: string, selected: boolean) => void
}> = ({ status, cards, tz, selectedId, onAdd, onSelect }) => {
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
        statusBgClass(status),
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
            tz={tz}
            isSelected={card.id === selectedId}
            onSelect={(selected) => onSelect(card.id, selected)}
          />
        ))}
        {cards.length === 0 && <p className='p-2 text-xs text-gray-500'>{t('msg_no_tickets')}</p>}
      </div>
    </fieldset>
  )
}
