'use client'

import { AssignmentMembers } from '@/components/assignment/assignment-members'
import { GroupAssignForm } from '@/components/assignment/group-assign-form'
import { AccordionSection } from '@/components/general/accordion'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { usePagingList } from '@/components/general/paging'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import { ArrowLeftCircleIcon, Cog6ToothIcon, UserGroupIcon, UsersIcon } from '@/components/icon'
import { NoAccessView } from '@/components/no-access-view'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { Accordion } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC } from 'react'
import {
  addCommandTargetMember,
  getCommandTargetAssignments,
  getCommandTargetMembersForAdmin,
  removeCommandTargetMember,
  setCommandTargetGroups,
  updateCommandTargetMemberRole,
} from '../server'

const defaultExpandedKeys = new Set(['command_target_members', 'command_target_groups'])

/**
 * ターゲットのアサイン編集(管理者のみ)。
 *
 * コマンド定義の編集はここには無い。それはターゲットのオーナーの領分で、
 * `/commands/targets/[targetId]` から行う。
 */
export const AdminCommandTargetClient: FC<{ targetKey: string }> = ({ targetKey }) => {
  const { t } = useLocale()
  const router = useRouter()
  const {
    data: assignments,
    reload: reloadAssignments,
    isLoading,
  } = useActionData(() => getCommandTargetAssignments({ targetKey }))

  // グループの保存と合わせてリロードできるよう、ここで生成して AssignmentMembers へ渡す
  const memberList = usePagingList({
    load: async () => (await parseAction(getCommandTargetMembersForAdmin({ targetKey }), { handled: 'all' })) ?? [],
    sort: { init: { column: 'name', direction: 'ascending' } },
  })

  if (isLoading && !assignments) {
    return <PanelSkeleton />
  }

  // useActionData は ClientError を通知しないため、取得できなかったことをここで表示する
  if (!assignments) {
    return <NoAccessView icon={<Cog6ToothIcon />} title={t('command_target_assign')} backHref='/admin/commands' />
  }

  return (
    <FlexCol>
      <ContentHeader icon={<Cog6ToothIcon />} title={assignments.targetLabel}>
        <MultiButton
          isIconOnly
          tooltip={t('back')}
          icon={<ArrowLeftCircleIcon />}
          onPress={() => router.push('/admin/commands')}
        />
      </ContentHeader>

      <div className='text-muted font-mono text-xs break-all'>{targetKey}</div>

      <Accordion allowsMultipleExpanded defaultExpandedKeys={defaultExpandedKeys}>
        <AccordionSection id='command_target_members' icon={<UsersIcon />} title={t('command_target_members')}>
          <AssignmentMembers
            aria-label='command target member list'
            hasRole
            reloadAssignments={reloadAssignments}
            pagingList={memberList}
            manage={{
              addLabel: t('add_member'),
              userOptions: assignments.userOptions,
              assignedUserIds: assignments.memberUserIds,
              add: (req) => addCommandTargetMember({ targetKey, ...req }),
              updateRole: (req) => updateCommandTargetMemberRole({ targetKey, ...req }),
              remove: (userId) => removeCommandTargetMember({ targetKey, userId }),
              roleNote: t('msg_command_owner_can_edit'),
            }}
          />
        </AccordionSection>

        <AccordionSection id='command_target_groups' icon={<UserGroupIcon />} title={t('command_target_groups')}>
          <GroupAssignForm
            key={assignments.groupIds.join(',')}
            label={t('command_target_groups')}
            groupOptions={assignments.groupOptions}
            groupIds={assignments.groupIds}
            notice={<NoticePanel className='text-xs'>{t('msg_command_group_is_member')}</NoticePanel>}
            onSave={(groupIds) => setCommandTargetGroups({ targetKey, groupIds })}
            reload={() => {
              reloadAssignments()
              memberList.reload()
            }}
          />
        </AccordionSection>
      </Accordion>
    </FlexCol>
  )
}
