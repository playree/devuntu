'use client'

import type { TagColor, TicketPriority } from '@/generated/prisma/enums'
import { Chip, ChipProps, cn } from '@heroui/react'
import { FC, ReactNode } from 'react'
import { agentStateChip, priorityChip, statusChip } from './ticket-options'
import { priorityBarClass, tagColorClass } from './ticket-style'

export const StatusChip = statusChip.EnumChip

/** 処理状態の Chip。state が null のチケットは queued 扱い(agent.ts の agentStateWhere と同じ規約)なので、呼び出し側で寄せる */
export const AgentStateChip = agentStateChip.EnumChip

export const PriorityChip = priorityChip.EnumChip

/**
 * 優先度を色だけで示す 1px の水平線 2 本。カード上端の行で ID の右に並べ、残り幅に敷く想定。
 * 同じ情報を PriorityChip がテキストで持つため、支援技術からは隠す。
 */
export const PriorityBar: FC<{ priority: TicketPriority; className?: string }> = ({ priority, className }) => (
  <div aria-hidden className={priorityBarClass(priority, className)} />
)

/**
 * チケットの表示ID(`KEY-番号`)。値はサーバー側で組み立てたものをそのまま出す。
 * 桁の違いで揃わなくならないよう等幅で、本文より一段弱い色にして件名を主役に保つ。
 */
export const TicketIdText: FC<{ displayId: string; className?: string }> = ({ displayId, className }) => (
  <span className={cn('text-muted font-mono text-xs', className)}>{displayId}</span>
)

/** タグ 1 件ぶんの Chip。色は tagStyles で当てる */
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
    className={tagColorClass(tag.color, className)}
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
