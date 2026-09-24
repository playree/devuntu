'use client'

import { AccordionSection } from '@/components/general/accordion'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { usePagingList } from '@/components/general/paging'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import { ArrowLeftCircleIcon, Cog6ToothIcon, UserGroupIcon, UsersIcon } from '@/components/icon'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { Accordion } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC } from 'react'
import { getCommandTargetAssignmentsAction, getCommandTargetMembersAction } from '../server'
import { GroupManage } from './group-manage'
import { TargetMembers } from './target-members'

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
  } = useActionData(() => getCommandTargetAssignmentsAction({ targetKey }))

  // グループの保存と合わせてリロードできるよう、ここで生成して TargetMembers へ渡す
  const memberList = usePagingList({
    load: async () => (await parseAction(getCommandTargetMembersAction({ targetKey }), { handled: 'all' })) ?? [],
    sort: { init: { column: 'name', direction: 'ascending' } },
  })

  if (isLoading && !assignments) {
    return <PanelSkeleton />
  }

  // useActionData は ClientError を通知しないため、取得できなかったことをここで表示する
  if (!assignments) {
    return (
      <FlexCol>
        <ContentHeader icon={<Cog6ToothIcon />} title={t('command_target_assign')}>
          <MultiButton
            isIconOnly
            tooltip={t('back')}
            icon={<ArrowLeftCircleIcon />}
            onPress={() => router.push('/admin/commands')}
          />
        </ContentHeader>
        <NoticePanel>{t('msg_no_access')}</NoticePanel>
      </FlexCol>
    )
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

      <div className='text-foreground-500 font-mono text-xs break-all'>{targetKey}</div>

      <Accordion allowsMultipleExpanded defaultExpandedKeys={defaultExpandedKeys}>
        <AccordionSection id='command_target_members' icon={<UsersIcon />} title={t('command_target_members')}>
          <TargetMembers
            targetKey={targetKey}
            assignments={assignments}
            reloadAssignments={reloadAssignments}
            pagingList={memberList}
          />
        </AccordionSection>

        <AccordionSection id='command_target_groups' icon={<UserGroupIcon />} title={t('command_target_groups')}>
          <GroupManage
            /**
             * 再取得しても useForm の defaultValues は追従しないので、
             * アサインが変わったら作り直して古い groupIds で保存されないようにする
             */
            key={assignments.groupIds.join(',')}
            targetKey={targetKey}
            assignments={assignments}
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
