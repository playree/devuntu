'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { MultiSelectCtrl } from '@/components/general/select'
import { CheckIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action-client'
import { scSetBoardGroups, SetBoardGroupsIn } from '@/lib/schema'
import { useLocale } from '@/locale/client'
import { Chip } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { GetBoardAssignmentsReturnType, setBoardGroups } from './server'

type Assignments = NonNullable<GetBoardAssignmentsReturnType>

/**
 * グループ単位のアサイン(管理者のみ)。
 * ユーザー単位のアサインは一覧の追加ボタン / 操作列(board-members.tsx)から行う。
 */
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
      <FlexCol isSmart>
        <MultiSelectCtrl
          control={control}
          name='groupIds'
          groupOptions={assignments.groupOptions}
          label={t('board_groups')}
        />
        <div className='flex items-center gap-2'>
          <Chip variant='soft' color='warning' size='sm'>
            <Chip.Label>{t('msg_group_assign_admin_only')}</Chip.Label>
          </Chip>
          <MultiButton className='ml-auto' type='submit' icon={<CheckIcon />} isPending={isSubmitting}>
            {t('save')}
          </MultiButton>
        </div>
      </FlexCol>
    </form>
  )
}
