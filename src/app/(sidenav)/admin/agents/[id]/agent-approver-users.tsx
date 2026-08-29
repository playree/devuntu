'use client'

import { ActionCell } from '@/components/action-cell'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { useModalState } from '@/components/general/modal'
import { PagingList } from '@/components/general/paging'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, UserPlusIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import type { UserSelectOption } from '@/components/user-select'
import { parseAction } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { ButtonGroup, Table } from '@heroui/react'
import { FC } from 'react'
import { AddAgentApproverModal } from './agent-approver-modals'
import { GetAgentApproverUsersReturnType, removeAgentApproverUser } from './server'

type AgentApproverUser = NonNullable<GetAgentApproverUsersReturnType>[number]

/**
 * 承認ユーザーの一覧(テーブル)と、追加 / 削除。行操作ごとに即時DB反映する。
 * 承認グループはこのテーブルとは別枠(agent-approver.tsx側)で管理する。
 * 承認グループの保存と合わせてリロードできるよう、`usePagingList` の呼び出しは
 * 親(agent-approver.tsx)側で行い、ここでは結果だけを受け取る(agent-run-history.tsx と同じ形)
 */
export const AgentApproverUsers: FC<{
  agentId: string
  assignedUserIds: string[]
  userOptions: UserSelectOption[]
  reloadAssignments: () => void
  pagingList: PagingList<AgentApproverUser>
}> = ({ agentId, assignedUserIds, userOptions, reloadAssignments, pagingList }) => {
  const { t } = useLocale()
  const addModalState = useModalState()

  // 承認ユーザーの候補(assignedUserIds)も追加後に変わるため、一覧と一緒に取り直す
  const reload = () => {
    reloadAssignments()
    pagingList.reload()
  }

  return (
    <FlexCol>
      <ContentHeader>
        <MultiButton isIconOnly tooltip={t('add_agent_approver_user')} onPress={() => addModalState.open()}>
          <UserPlusIcon />
        </MultiButton>
        <MultiButton isIconOnly tooltip={t('reload')} onPress={() => pagingList.reload()}>
          <ButtonGroup.Separator />
          <ArrowPathIcon />
        </MultiButton>
      </ContentHeader>

      <MultiTable
        ariaLabel='agent approver user list'
        pagingList={pagingList}
        isSmart
        columns={[
          { id: 'name', name: t('name'), isRowHeader: true, allowsSorting: true, minWidth: 100 },
          { id: 'email', name: t('email'), allowsSorting: true, minWidth: 140, defaultWidth: '2fr' },
          { id: 'via', name: t('via'), allowsSorting: true, minWidth: 70 },
          { id: 'action', name: t('action'), allowsSorting: false, defaultWidth: 60 },
        ]}
      >
        {(item) => (
          <Table.Row key={item.id} id={item.id}>
            <Table.Cell className='truncate'>{item.name}</Table.Cell>
            <Table.Cell className='truncate font-mono text-xs'>{item.email}</Table.Cell>
            <Table.Cell>{item.via === 'group' ? t('group') : t('direct')}</Table.Cell>
            <ActionCell
              items={
                // グループ経由の承認者は外す対象の AgentApprover 行が無いので削除させない(外すには承認グループの設定を変更する)
                item.via === 'user'
                  ? [
                      {
                        template: 'delete',
                        target: item.name,
                        action: async () => {
                          await parseAction(removeAgentApproverUser({ id: agentId, userId: item.id }))
                          notify.success(t('msg_deleted_target', { target: item.name }))
                          reload()
                        },
                      },
                    ]
                  : []
              }
            />
          </Table.Row>
        )}
      </MultiTable>

      <AddAgentApproverModal
        state={addModalState}
        reload={reload}
        key={addModalState.key}
        agentId={agentId}
        userOptions={userOptions}
        assignedUserIds={assignedUserIds}
      />
    </FlexCol>
  )
}
