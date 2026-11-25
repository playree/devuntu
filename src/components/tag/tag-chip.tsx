'use client'

import type { TagColor } from '@/generated/prisma/enums'
import { Chip, ChipProps } from '@heroui/react'
import { FC, ReactNode } from 'react'
import { tagColorClass } from './tag-style'

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
