'use client'

import { MultiButton } from '@/components/general/button'
import { ArrowPathIcon, StopIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import type { AgentTaskState } from '@/generated/prisma/enums'
import { parseAction } from '@/lib/action/action-client'
import { useConfirmAction } from '@/lib/use-confirm-action'
import { useLocale } from '@/locale/client'
import { FC } from 'react'
import { cancelAgentTicketRun, retryAgentTicket } from './server'

/** 再実行できる処理状態(サーバー側の判定と同じ) */
const RETRYABLE_STATES: ReadonlySet<AgentTaskState> = new Set(['failed', 'skipped'])

/**
 * エージェントの処理の停止・再実行ボタン(承認者だけに出す)。
 *
 * - 停止: 実行中の実行があるとき。ランナー側の CLI は止まらない旨を確認で示す
 * - 再実行: 失敗・見送りで、実行中の実行が残っていないとき
 */
export const AgentRunControl: FC<{
  ticketId: string
  state: AgentTaskState | null
  /** 実行中の実行があるか */
  isRunning: boolean
  refresh: () => Promise<void>
}> = ({ ticketId, state, isRunning, refresh }) => {
  const { t } = useLocale()
  const confirmAction = useConfirmAction()

  const stop = () =>
    confirmAction({ title: t('agent_stop'), text: t('msg_confirm_agent_stop') }, async () => {
      await parseAction(cancelAgentTicketRun({ id: ticketId }))
      notify.success(t('msg_agent_stopped'))
      await refresh()
    })

  const retry = () =>
    confirmAction({ title: t('agent_retry'), text: t('msg_confirm_agent_retry') }, async () => {
      await parseAction(retryAgentTicket({ id: ticketId }))
      notify.success(t('msg_agent_retried'))
      await refresh()
    })

  if (isRunning) {
    return (
      <MultiButton size='sm' variant='outline' isSmart icon={<StopIcon width={14} />} onPress={stop}>
        {t('agent_stop')}
      </MultiButton>
    )
  }
  if (state && RETRYABLE_STATES.has(state)) {
    return (
      <MultiButton size='sm' variant='outline' isSmart icon={<ArrowPathIcon width={14} />} onPress={retry}>
        {t('agent_retry')}
      </MultiButton>
    )
  }
  return null
}
