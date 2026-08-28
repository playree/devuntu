'use client'

import { MultiButton } from '@/components/general/button'
import { useConfirmModal } from '@/components/general/modal'
import { TrashIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action/action-client'
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
  const { confirmModal } = useConfirmModal()

  const removeAgent = async () => {
    try {
      const ok = await confirmModal().confirm({
        title: t('confirm_deletion'),
        text: t('msg_confirm_deletion', { target: agent.name }),
        requireCheck: true,
        autoClose: false,
      })
      if (ok) {
        await parseAction(deleteAgent({ id: agent.id }))
        notify.success(t('msg_deleted_target', { target: agent.name }))
        router.push('/admin/agents')
      }
    } finally {
      confirmModal().close()
    }
  }

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
