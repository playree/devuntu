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
