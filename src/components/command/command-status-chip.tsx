'use client'

import { type CommandRunStatus } from '@/generated/prisma/enums'
import { type LocaleItem } from '@/locale'
import { useLocale } from '@/locale/client'
import { Chip } from '@heroui/react'
import { FC } from 'react'

/** 状態 → 表示。Prisma の enum が増えたらここがコンパイルエラーになる */
const STATUS_VIEW = {
  queued: { color: 'default', label: 'command_status_queued' },
  running: { color: 'accent', label: 'command_status_running' },
  succeeded: { color: 'success', label: 'command_status_succeeded' },
  failed: { color: 'danger', label: 'command_status_failed' },
  canceled: { color: 'warning', label: 'command_status_canceled' },
} as const satisfies Record<CommandRunStatus, { color: string; label: LocaleItem }>

export const CommandStatusChip: FC<{ status: CommandRunStatus }> = ({ status }) => {
  const { t } = useLocale()
  const { color, label } = STATUS_VIEW[status]
  return (
    <Chip color={color} variant='soft' className='whitespace-nowrap'>
      {t(label)}
    </Chip>
  )
}
