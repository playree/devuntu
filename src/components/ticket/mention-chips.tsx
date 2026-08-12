'use client'

import { useLocale } from '@/locale/client'
import { Chip, cn } from '@heroui/react'
import { FC } from 'react'

/**
 * 保存時に解決されたメンションの一覧。
 *
 * 本文中の `@名前` は素のテキストとして表示されるため、実際に誰へ届いたのかは
 * 本文の外にこの形で出す(同名衝突などで解決されなかった名前はここに並ばない)。
 */
export const MentionChips: FC<{ names: string[]; className?: string }> = ({ names, className }) => {
  const { t } = useLocale()

  if (names.length === 0) {
    return null
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      <span className='text-xs text-gray-500'>{t('mentioned')}</span>
      {names.map((name) => (
        <Chip key={name} variant='soft' color='accent' size='sm'>
          <Chip.Label>{name}</Chip.Label>
        </Chip>
      ))}
    </div>
  )
}
