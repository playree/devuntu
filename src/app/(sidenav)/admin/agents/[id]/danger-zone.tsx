'use client'

import { MultiButton } from '@/components/general/button'
import { TrashIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action/action-client'
import { useConfirmAction } from '@/lib/use-confirm-action'
import { useLocale } from '@/locale/client'
import { useRouter } from 'next/navigation'
import { FC } from 'react'
import { deleteAgent, GetAgentReturnType } from './server'

type Agent = NonNullable<GetAgentReturnType>

/**
 * エージェント削除。AgentToken / AgentRunner / AgentRun は onDelete: Cascade で一緒に消える。
 * 誤操作を防ぐため、チェック必須の確認モーダルを通す。
 */
export const DangerZone: FC<{ agent: Agent }> = ({ agent }) => {
  const { t } = useLocale()
  const router = useRouter()
  const confirmAction = useConfirmAction()

  const removeAgent = () =>
    confirmAction(
      { title: t('confirm_deletion'), text: t('msg_confirm_deletion', { target: agent.name }) },
      async () => {
        await parseAction(deleteAgent({ id: agent.id }))
        notify.success(t('msg_deleted_target', { target: agent.name }))
        router.push('/admin/agents')
      },
    )

  return (
    <div className='flex flex-wrap items-center gap-2 py-3'>
      <div className='min-w-0 flex-1'>
        <div className='text-sm font-semibold'>{t('delete')}</div>
      </div>
      <MultiButton size='sm' variant='danger-soft' icon={<TrashIcon />} onPress={removeAgent}>
        {t('delete')}
      </MultiButton>
    </div>
  )
}
