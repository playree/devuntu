'use client'

import { AssignmentMembers } from '@/components/assignment/assignment-members'
import { GroupAssignForm } from '@/components/assignment/group-assign-form'
import { GridBox } from '@/components/general/grid'
import { usePagingList } from '@/components/general/paging'
import { NoticePanel } from '@/components/general/panel'
import type { UserSelectOption } from '@/components/user-select'
import { parseAction } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { FC } from 'react'
import {
  addAgentApproverUser,
  GetAgentApproversReturnType,
  getAgentApproverUsers,
  removeAgentApproverUser,
  saveAgentApproverGroups,
} from './server'

/**
 * 承認者の設定。
 * 承認ユーザーはテーブル(行操作ごとに即時反映)、承認グループは複数選択+保存。
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

  // 承認グループの保存と合わせてリロードできるよう、ここで生成して AssignmentMembers に渡す
  const list = usePagingList({
    load: async () => (await parseAction(getAgentApproverUsers({ id: agentId }), { handled: 'all' })) ?? [],
    sort: { init: { column: 'name', direction: 'ascending' } },
  })

  return (
    <GridBox isSmart>
      <div className='col-span-12'>
        <NoticePanel className='text-xs'>{t('msg_agent_approver_desc')}</NoticePanel>
      </div>

      <div className='col-span-12'>
        <AssignmentMembers
          aria-label='agent approver user list'
          hasRole={false}
          reloadAssignments={refresh}
          pagingList={list}
          manage={{
            addLabel: t('add_agent_approver_user'),
            userOptions,
            assignedUserIds: current?.userIds ?? [],
            add: ({ userId }) => addAgentApproverUser({ id: agentId, userId }),
            remove: (userId) => removeAgentApproverUser({ id: agentId, userId }),
          }}
        />
      </div>

      <div className='col-span-12'>
        <GroupAssignForm
          key={current?.groupIds.join(',')}
          label={t('agent_approver_group')}
          groupOptions={groupOptions}
          groupIds={current?.groupIds ?? []}
          status={
            (current?.userIds.length ?? 0) === 0 &&
            (current?.groupIds.length ?? 0) === 0 && (
              <span className='text-danger text-xs'>{t('msg_agent_no_approver')}</span>
            )
          }
          onSave={(groupIds) => saveAgentApproverGroups({ id: agentId, groupIds })}
          reload={() => {
            refresh()
            list.reload()
          }}
        />
      </div>
    </GridBox>
  )
}
