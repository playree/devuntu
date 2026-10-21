'use client'

import { CpuChipIcon } from '@/components/icon'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { dayformat } from '@/lib/day'
import { useLocale } from '@/locale/client'
import { Chip } from '@heroui/react'
import { FC } from 'react'

/** 更新者と経路。AI が MCP で書いたものはそれと分かるようにする */
export const NoteUpdatedBy: FC<{
  name: string | undefined
  isAgent?: boolean
  via: 'web' | 'mcp'
  at: Date
}> = ({ name, isAgent, via, at }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  return (
    <span className='text-muted flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs'>
      <span className='flex items-center gap-1'>
        {isAgent && <CpuChipIcon width={14} />}
        {name || t('no_name')}
      </span>
      {via === 'mcp' && (
        <Chip variant='soft' size='sm'>
          <Chip.Label>MCP</Chip.Label>
        </Chip>
      )}
      <span className='font-mono'>{dayformat(at, 'tz-minute', tz)}</span>
    </span>
  )
}
