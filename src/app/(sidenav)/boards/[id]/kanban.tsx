'use client'

import { UserAvatar } from '@/components/general/avatar'
import { MultiButton } from '@/components/general/button'
import { ChatBubbleIcon, CheckBadgeIcon, ClockIcon, FireIcon, PlusIcon } from '@/components/icon'
import {
  CARD_BACKDROP_CLASS,
  PriorityBar,
  priorityBgClass,
  priorityBorderClass,
  PriorityChip,
  statusBgClass,
  StatusChip,
  TagChips,
  TicketIdText,
} from '@/components/ticket/ticket-chip'
import type { TicketStatus } from '@/generated/prisma/enums'
import { preventParentSelection } from '@/lib/client-utils'
import { dayformat, isDateOnlyOverdue } from '@/lib/day'
import { cardDropId, KANBAN_LANES, laneDropId } from '@/lib/task'
import { useLocale } from '@/locale/client'
import { PointerActivationConstraints } from '@dnd-kit/dom'
import { KeyboardSensor, PointerSensor, useDraggable, useDroppable } from '@dnd-kit/react'
import { cn } from '@heroui/react'
import Link from 'next/link'
import { FC } from 'react'
import { tv } from 'tailwind-variants'
import { GetBoardKanbanReturnType } from './server'

type Kanban = NonNullable<GetBoardKanbanReturnType>
export type KanbanCard = Kanban['lanes']['todo'][number]

/** DnD の type。カード以外のドラッグと混ざらないようにする */
const DRAG_TYPE = 'ticket'

/**
 * カードの高さを一杯まで使うレーン(todo/doing/done)のカード領域。
 */
const SCROLL_CARDS_CLASS = 'md:-m-0.5 md:flex-1 md:overflow-y-auto md:p-0.5'

/**
 * backlog のカード領域の高さ上限。グリッド表示のカード2行分で頭打ちにして、残りはレーン内でスクロールさせる。
 *
 * カードは内容なりの高さなので、一番背が高くなる構成(タイトル2行 + メタ行 + タグ行 = 実測 117px)を基準に
 * 117px × 2行 + gap-2(8px) + p-0.5 の上下(4px) = 246px を満たす値にしている。
 *
 * md 未満は1カラムの縦積みでレーン内スクロールも掛けないため、上限も掛けない(ページスクロールに任せる)。
 */
const BACKLOG_MAX_H_CLASS = 'md:max-h-[16rem]'

/**
 * レーンの配置。todo/doing/done を横3列、その下に backlog を全幅で置く。
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
      'md:grid md:grid-cols-3 md:items-start md:gap-2 md:space-y-0 xl:grid-cols-4',
      BACKLOG_MAX_H_CLASS,
      'md:-m-0.5 md:overflow-y-auto md:p-0.5',
    ),
  },
}

/** かんばんのレーン表示順(横3列 + backlog) */
export const LANE_ORDER = KANBAN_LANES

/**
 * カード用のセンサー。カードは全体がクリックで選択できるので、指を動かさない操作は必ずクリックにする。
 */
const CARD_SENSORS = [
  PointerSensor.configure({
    activationConstraints: (event) =>
      event.pointerType === 'touch'
        ? [new PointerActivationConstraints.Delay({ value: 250, tolerance: 5 })]
        : [new PointerActivationConstraints.Distance({ value: 5 })],
  }),
  KeyboardSensor.configure({
    keyboardCodes: {
      start: ['Space'],
      cancel: ['Escape'],
      end: ['Space', 'Tab'],
      up: ['ArrowUp'],
      down: ['ArrowDown'],
      left: ['ArrowLeft'],
      right: ['ArrowRight'],
    },
  }),
]

/**
 * 期日行の配色。期限切れは色だけでなくアイコンも変えるので、判定は 1 箇所に持たせて呼び出し側で共有する。
 * クラス名は purge 対策で必ず完全なリテラルで書くこと(ticket-chip.tsx と同じ規約)。
 */
const dueDateStyles = tv({
  base: 'flex items-center gap-0.5 text-xs',
  variants: {
    overdue: {
      true: 'text-danger',
      false: 'text-gray-500',
    },
  },
})

/** カード 1 枚。レーン移動は DnD、それ以外の変更は選択して詳細パネルから行う */
const KanbanCardView: FC<{
  card: KanbanCard
  /** 完了日時の表示と期限切れ判定に使うユーザーのタイムゾーン。カードごとにセッションを購読しないよう上から渡す */
  tz: string
  isSelected: boolean
  onSelect: (selected: boolean) => void
}> = ({ card, tz, isSelected, onSelect }) => {
  const { t } = useLocale()
  const { ref: dropRef, isDropTarget } = useDroppable({ id: cardDropId(card.id), accept: DRAG_TYPE })
  const { ref: dragRef, isDragging } = useDraggable({ id: card.id, type: DRAG_TYPE, sensors: CARD_SENSORS })

  const toggle = () => onSelect(!isSelected)

  const overdue = isDateOnlyOverdue(card.dueDate, tz)

  return (
    <div // 外側 = ドロップ枠 兼 選択の当たり判定。ドラッグ中も矩形が元位置に留まるので挿入位置の基準が安定する
      ref={dropRef}
      /**
       * カード全体を押して詳細パネルを開く。内側のどこを押しても拾えるようここで受ける。
       */
      onClick={toggle}
      onKeyDown={(e) => {
        // Space はキーボードでのドラッグ開始(KeyboardSensor)に使うので Enter だけを選択にする
        if (e.key !== 'Enter' || e.defaultPrevented) {
          return
        }
        e.preventDefault()
        toggle()
      }}
      className={cn(
        'cursor-pointer rounded-xl',
        // 半透明のカード背景(priorityBgClass)がレーンの色と混色されないよう、最背面に不透明な下地を敷く
        CARD_BACKDROP_CLASS,
        // ドラッグ中の挿入位置の方が情報として重要なので、ドロップ対象の枠を選択の枠より優先する
        isDropTarget
          ? 'ring-2 ring-blue-300'
          : isSelected
            ? 'ring-2 ring-blue-500'
            : 'hover:ring-2 hover:ring-blue-200',
      )}
    >
      <div // ref を1要素へまとめるとインライン合成で毎レンダー detach/attach が走るため入れ子にする
        ref={dragRef}
        /**
         * 詳細パネルに出ている 1 枚であることを支援技術へ伝える。
         * aria-pressed / aria-grabbed は dnd-kit がドラッグ中かどうかで上書きするので使えない。
         */
        aria-current={isSelected}
        className={cn(
          /**
           * flex-col は「ID + PriorityBar のヘッダ行」+「内容」の縦 2 段。
           * 上端に border を持たないのは、上端は PriorityBar の線が輪郭を兼ねるため。
           * 代わりにダークでは priorityBorderClass が線と同系色の枠を左右と下に出す。
           *
           * relative は配下の sr-only(position: absolute)の包含ブロックをカードに閉じるため。
           * 無いとルートレイアウトの relative が包含ブロックになり、レーンの overflow-y-auto では
           * クリップされずスクロールで隠れた分だけページ全体のスクロール範囲を押し広げる。
           */
          'relative flex flex-col overflow-hidden rounded-xl',
          // フォーカスを受けるのは dnd-kit が tabindex を付けるこの要素なので、枠線もここに出す
          'outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
          priorityBgClass(card.priority),
          priorityBorderClass(card.priority),
          isDragging ? 'opacity-60' : '',
        )}
      >
        <div // ID と優先度バーの行。上端へ寄せてバーがカード上辺の輪郭を兼ねる
          className='flex items-center gap-2 px-2 pt-0'
        >
          <TicketIdText // 同一ボードなので接頭辞は全カード共通だが、口頭・チャットで指すときに読み上げる値なので出す
            displayId={card.displayId}
          />
          <PriorityBar priority={card.priority} />
        </div>

        <div className='space-y-1 px-2 pt-0.5 pb-2'>
          <p // 空白のない長いタイトルでもレーン幅を超えないよう wrap-anywhere で任意位置折り返しにする
            className='line-clamp-2 text-sm wrap-anywhere'
          >
            <Link // line-clamp は display:-webkit-box なので Link 側に持たせると行全体がリンク範囲になる。外側の p に寄せて Link はインラインのまま文字列だけを範囲にする
              href={`/tickets/${card.id}`}
              className='hover:underline'
              {...preventParentSelection} // リンクの押下は遷移だけにして、カードの選択は起こさない
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
                <span className={dueDateStyles({ overdue })}>
                  {overdue ? <FireIcon width={12} /> : <ClockIcon width={12} />}
                  <span // 色だけで期限切れを伝えないよう、読み上げるラベルも差し替える
                    className='sr-only'
                  >
                    {overdue ? t('overdue') : t('due_date')}
                  </span>
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
