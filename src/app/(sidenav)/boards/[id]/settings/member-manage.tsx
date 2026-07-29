'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { MultiSelectCtrl } from '@/components/general/select'
import { CheckIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action-client'
import { scSetBoardGroups, scSetBoardMembers, SetBoardGroupsIn, SetBoardMembersIn } from '@/lib/schema'
import { useLocale } from '@/locale/client'
import { Chip } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { GetBoardAssignmentsReturnType, setBoardGroups, setBoardMembers } from './server'

type Assignments = NonNullable<GetBoardAssignmentsReturnType>

/**
 * ユーザー単位のアサイン(owner または管理者)。
 * グループ経由のメンバーもここで owner に含めれば昇格でき、外せばグループ経由 member へ戻る。
 */
export const MemberManage: FC<{ boardId: string; assignments: Assignments; reload: () => void }> = ({
  boardId,
  assignments,
  reload,
}) => {
  const { t } = useLocale()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<SetBoardMembersIn>({
    resolver: zodResolver(scSetBoardMembers),
    mode: 'onChange',
    defaultValues: { id: boardId, ownerIds: assignments.ownerIds, memberIds: assignments.memberIds },
  })

  return (
    <form
      onSubmit={handleSubmit(async (req) => {
        await parseAction(setBoardMembers(req))
        notify.success(t('msg_saved'))
        reload()
      })}
    >
      <FlexCol>
        <MultiSelectCtrl
          control={control}
          name='ownerIds'
          variant='secondary'
          groupOptions={assignments.userOptions}
          label={t('owner')}
          isSmart
        />
        <MultiSelectCtrl
          control={control}
          name='memberIds'
          variant='secondary'
          groupOptions={assignments.userOptions}
          label={t('member')}
          isSmart
        />
        <div className='flex items-center gap-2'>
          <span className='text-xs text-gray-500'>{t('msg_owner_required')}</span>
          <MultiButton className='ml-auto' type='submit' size='sm' icon={<CheckIcon />} isPending={isSubmitting}>
            {t('save')}
          </MultiButton>
        </div>
      </FlexCol>
    </form>
  )
}

/** グループ単位のアサイン(管理者のみ) */
export const GroupManage: FC<{ boardId: string; assignments: Assignments; reload: () => void }> = ({
  boardId,
  assignments,
  reload,
}) => {
  const { t } = useLocale()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<SetBoardGroupsIn>({
    resolver: zodResolver(scSetBoardGroups),
    mode: 'onChange',
    defaultValues: { id: boardId, groupIds: assignments.groupIds },
  })

  return (
    <form
      onSubmit={handleSubmit(async (req) => {
        await parseAction(setBoardGroups(req))
        notify.success(t('msg_saved'))
        reload()
      })}
    >
      <FlexCol>
        <MultiSelectCtrl
          control={control}
          name='groupIds'
          variant='secondary'
          groupOptions={assignments.groupOptions}
          label={t('board_groups')}
          isSmart
        />
        <div className='flex items-center gap-2'>
          <Chip variant='soft' color='warning' size='sm'>
            <Chip.Label>{t('msg_group_assign_admin_only')}</Chip.Label>
          </Chip>
          <MultiButton className='ml-auto' type='submit' size='sm' icon={<CheckIcon />} isPending={isSubmitting}>
            {t('save')}
          </MultiButton>
        </div>
      </FlexCol>
    </form>
  )
}
