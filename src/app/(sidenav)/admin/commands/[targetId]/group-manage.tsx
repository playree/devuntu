'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { NoticePanel } from '@/components/general/panel'
import { MultiSelectCtrl } from '@/components/general/select'
import { CheckIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action/action-client'
import { scSetCommandTargetGroups, type SetCommandTargetGroupsIn } from '@/lib/schema/schema'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { type GetCommandTargetAssignmentsReturnType, setCommandTargetGroupsAction } from '../server'

type Assignments = NonNullable<GetCommandTargetAssignmentsReturnType>

/**
 * グループ単位のアサイン。
 * グループ経由のメンバーはロールを持たず、常に member 相当になる。
 * オーナーを付けたい相手はユーザー単位でアサインする。
 */
export const GroupManage: FC<{ targetKey: string; assignments: Assignments; reload: () => void }> = ({
  targetKey,
  assignments,
  reload,
}) => {
  const { t } = useLocale()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<SetCommandTargetGroupsIn>({
    resolver: zodResolver(scSetCommandTargetGroups),
    mode: 'onChange',
    defaultValues: { targetKey, groupIds: assignments.groupIds },
  })

  return (
    <form
      onSubmit={handleSubmit(async (req) => {
        await parseAction(setCommandTargetGroupsAction(req))
        notify.success(t('msg_saved'))
        reload()
      })}
    >
      <FlexCol isSmart>
        <MultiSelectCtrl
          control={control}
          name='groupIds'
          groupOptions={assignments.groupOptions}
          label={t('command_target_groups')}
        />
        <NoticePanel className='text-xs'>{t('msg_command_group_is_member')}</NoticePanel>
        <div className='flex items-center gap-2'>
          <MultiButton className='ml-auto' type='submit' icon={<CheckIcon />} isPending={isSubmitting}>
            {t('save')}
          </MultiButton>
        </div>
      </FlexCol>
    </form>
  )
}
