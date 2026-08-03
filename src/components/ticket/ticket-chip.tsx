'use client'

import type { BoardKind, TagColor, TicketPriority, TicketStatus } from '@/generated/prisma/enums'
import { LocaleItemBase } from '@/locale'
import { useLocale } from '@/locale/client'
import { Chip, ChipProps, cn } from '@heroui/react'
import { FC, ReactNode, useCallback } from 'react'

type ChipColor = ChipProps['color']

/** ステータスのロケールキーと表示色 */
const STATUS_STYLE: Record<TicketStatus, { item: LocaleItemBase; color: ChipColor }> = {
  backlog: { item: 'status_backlog', color: 'default' },
  todo: { item: 'status_todo', color: 'accent' },
  doing: { item: 'status_doing', color: 'warning' },
  done: { item: 'status_done', color: 'success' },
}

/**
 * 優先度のロケールキーと表示色。
 *
 * color は Chip 用の HeroUI セマンティック名なので bg-* には使えない。
 * バー用の背景色は bar、カード枠用の枠線色は border、カード自体の背景色は bg に持たせ、
 * 優先度の色を 1 箇所に集約する。bg はバーと同じ色を 10% で敷いて下地を透かす。
 * クラス名は purge 対策で必ず完全なリテラルで書くこと(TAG_COLOR_CLASS と同じ規約)。
 */
const PRIORITY_STYLE: Record<
  TicketPriority,
  { item: LocaleItemBase; color: ChipColor; bar: string; border: string; bg: string }
> = {
  urgent: {
    item: 'priority_urgent',
    color: 'danger',
    bar: 'bg-red-300 dark:bg-red-800',
    border: 'dark:border-red-800/30',
    bg: 'bg-red-300/10 dark:bg-red-800/10',
  },
  high: {
    item: 'priority_high',
    color: 'warning',
    bar: 'bg-amber-300 dark:bg-amber-800',
    border: 'dark:border-amber-800/30',
    bg: 'bg-amber-300/10 dark:bg-amber-800/10',
  },
  medium: {
    item: 'priority_medium',
    color: 'accent',
    bar: 'bg-blue-300 dark:bg-blue-800',
    border: 'dark:border-blue-800/30',
    bg: 'bg-blue-300/10 dark:bg-blue-800/10',
  },
  low: {
    item: 'priority_low',
    color: 'default',
    bar: 'bg-gray-200 dark:bg-gray-700',
    border: 'dark:border-gray-700/30',
    bg: 'bg-gray-200/10 dark:bg-gray-700/10',
  },
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

export const PriorityChip: FC<{ priority: TicketPriority; size?: ChipProps['size'] }> = ({ priority, size = 'sm' }) => {
  const { t } = useLocale()
  const { item, color } = PRIORITY_STYLE[priority]
  return (
    <Chip variant='soft' color={color} size={size}>
      <Chip.Label>{t(item)}</Chip.Label>
    </Chip>
  )
}

/**
 * 優先度を色だけで示す帯。カード上端に全幅で置く想定。
 * 同じ情報を PriorityChip がテキストで持つため、支援技術からは隠す。
 */
export const PriorityBar: FC<{ priority: TicketPriority; className?: string }> = ({ priority, className }) => (
  <div aria-hidden className={cn('h-1 w-full', PRIORITY_STYLE[priority].bar, className)} />
)

/**
 * PriorityBar を載せる箱の枠線。ダークは背景と周囲のコントラストが弱いので、
 * バーと同じ色で全周に枠を出して輪郭を作る(ライトは影で十分に浮くため透明のまま)。
 * テーマ切り替えでレイアウトが動かないよう、枠の幅は常に確保しておく。
 */
export const priorityBorderClass = (priority: TicketPriority) =>
  cn('border-b-3 border-transparent', PRIORITY_STYLE[priority].border)

/**
 * PriorityBar を載せる箱の背景色。バー / 枠と同じ色を 10% で敷き、下地を透かして淡く色を付ける。
 * 半透明なので単色の背景クラス(bg-sky-50 など)とは併用できない(後勝ちで打ち消し合う)。
 */
export const priorityBgClass = (priority: TicketPriority) => PRIORITY_STYLE[priority].bg

/**
 * タグの表示色。HeroUI Chip は色を 5 種しか持たないため Tailwind の utility で上書きする。
 *
 * ビルド出力でレイヤーの初出順が properties < theme < base < components < utilities であることを
 * 確認済み。HeroUI の .chip は @layer components にあるので `!` なしで後勝ちする
 * (崩れた場合は bg-red-200! のように `!` を付ける。globals.css に前例あり)。
 *
 * クラス名は purge 対策で必ず完全なリテラルで書くこと(bg-${color}-200 のような合成は不可)。
 */
export const TAG_COLOR_CLASS: Record<TagColor, string> = {
  gray: 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-100',
  red: 'bg-red-200 text-red-900 dark:bg-red-900 dark:text-red-100',
  orange: 'bg-orange-200 text-orange-900 dark:bg-orange-900 dark:text-orange-100',
  amber: 'bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100',
  green: 'bg-green-200 text-green-900 dark:bg-green-900 dark:text-green-100',
  teal: 'bg-teal-200 text-teal-900 dark:bg-teal-900 dark:text-teal-100',
  blue: 'bg-blue-200 text-blue-900 dark:bg-blue-900 dark:text-blue-100',
  indigo: 'bg-indigo-200 text-indigo-900 dark:bg-indigo-900 dark:text-indigo-100',
  violet: 'bg-violet-200 text-violet-900 dark:bg-violet-900 dark:text-violet-100',
  pink: 'bg-pink-200 text-pink-900 dark:bg-pink-900 dark:text-pink-100',
}

/** タグ 1 件ぶんの Chip。色は TAG_COLOR_CLASS で当てる */
export const TagChip: FC<{
  tag: { name: string; color: TagColor }
  size?: ChipProps['size']
  className?: string
  /** クリックで選択させる場合に渡す(Chip は role / onClick を透過する) */
  onClick?: () => void
  /** ラベルの後ろに置く要素(× ボタンなど) */
  children?: ReactNode
}> = ({ tag, size = 'sm', className, onClick, children }) => (
  <Chip
    variant='tertiary'
    size={size}
    className={cn(TAG_COLOR_CLASS[tag.color], className)}
    {...(onClick ? { role: 'button', onClick } : {})}
  >
    <Chip.Label>{tag.name}</Chip.Label>
    {children}
  </Chip>
)

export const TagChips: FC<{ tags: { id: string; name: string; color: TagColor }[]; size?: ChipProps['size'] }> = ({
  tags,
  size = 'sm',
}) => {
  if (tags.length === 0) {
    return null
  }
  return (
    <div className='flex flex-wrap gap-1'>
      {tags.map((tag) => (
        <TagChip key={tag.id} tag={tag} size={size} />
      ))}
    </div>
  )
}

/**
 * ボードの表示名を解決する。
 * プライベートボードは DB 上の name が固定値(PRIVATE_BOARD_NAME)なので、
 * ユーザーの言語設定に追従させるためロケールへ差し替える。
 */
export const useBoardName = () => {
  const { t } = useLocale()
  return useCallback(
    (board: { name: string; kind: BoardKind }) => (board.kind === 'private' ? t('private') : board.name),
    [t],
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
