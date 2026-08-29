'use client'

import { MultiButton } from '@/components/general/button'
import { GridBox } from '@/components/general/grid'
import { usePagingList } from '@/components/general/paging'
import { NoticePanel } from '@/components/general/panel'
import { MultiSelectCtrl } from '@/components/general/select'
import { CheckIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import type { UserSelectOption } from '@/components/user-select'
import { parseAction } from '@/lib/action/action-client'
import { scSetAgentApproverGroups, SetAgentApproverGroupsIn } from '@/lib/schema/schema'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { AgentApproverUsers } from './agent-approver-users'
import { GetAgentApproversReturnType, getAgentApproverUsers, saveAgentApproverGroups } from './server'

/**
 * 承認者の設定。
 * 承認ユーザーはテーブル(行操作ごとに即時反映)、承認グループは複数選択+保存の従来方式。
 * どちらにも誰も居ないエージェントは、チケットのエージェントモードを誰も変更できない。
 */
export const AgentApprover: FC<{
  agentId: string
  current: GetAgentApproversReturnType
  userOptions: UserSelectOption[]
  groupOptions: Record<string, string>
  refresh: () => void
}> = ({ agentId, current, userOptions, groupOptions, refresh }) => {
  const { t } = useLocale()

  // 承認グループの保存と合わせてリロードできるよう、ここで生成して AgentApproverUsers に渡す
  const list = usePagingList({
    load: async () => (await parseAction(getAgentApproverUsers({ id: agentId }))) ?? [],
    sort: { init: { column: 'name', direction: 'ascending' } },
  })

  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<SetAgentApproverGroupsIn>({
    resolver: zodResolver(scSetAgentApproverGroups),
    mode: 'onChange',
    defaultValues: {
      id: agentId,
      groupIds: current?.groupIds ?? [],
    },
  })

  return (
    <GridBox isSmart>
      <div className='col-span-12'>
        <NoticePanel className='text-xs'>{t('msg_agent_approver_desc')}</NoticePanel>
      </div>

      <div className='col-span-12'>
        <AgentApproverUsers
          agentId={agentId}
          assignedUserIds={current?.userIds ?? []}
          userOptions={userOptions}
          reloadAssignments={refresh}
          pagingList={list}
        />
      </div>

      <div className='col-span-12'>
        <form
          onSubmit={handleSubmit(async (req) => {
            await parseAction(saveAgentApproverGroups(req))
            notify.success(t('msg_saved'))
            reset(req)
            refresh()
            list.reload()
          })}
        >
          <GridBox isSmart>
            <div className='col-span-12'>
              <MultiSelectCtrl
                control={control}
                name='groupIds'
                groupOptions={groupOptions}
                label={t('agent_approver_group')}
              />
            </div>
            <div className='col-span-12 flex items-center gap-2'>
              {(current?.userIds.length ?? 0) === 0 && (current?.groupIds.length ?? 0) === 0 && (
                <span className='text-danger text-xs'>{t('msg_agent_no_approver')}</span>
              )}
              <MultiButton className='ml-auto' type='submit' size='sm' icon={<CheckIcon />} isPending={isSubmitting}>
                {t('save')}
              </MultiButton>
            </div>
          </GridBox>
        </form>
      </div>
    </GridBox>
  )
}
