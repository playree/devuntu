'use client'

import { createEnumChip } from '@/components/enum-chip'
import { type CommandRunStatus } from '@/generated/prisma/enums'

/** Prisma の enum が増えたらここがコンパイルエラーになる */
export const CommandStatusChip = createEnumChip<CommandRunStatus>({
  queued: { color: 'default', item: 'command_status_queued' },
  running: { color: 'accent', item: 'command_status_running' },
  succeeded: { color: 'success', item: 'command_status_succeeded' },
  failed: { color: 'danger', item: 'command_status_failed' },
  canceled: { color: 'warning', item: 'command_status_canceled' },
}).EnumChip
