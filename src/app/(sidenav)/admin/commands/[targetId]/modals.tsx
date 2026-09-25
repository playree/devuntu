'use client'

import { GridBox } from '@/components/general/grid'
import { FormModal, ModalBaseProps } from '@/components/general/modal'
import { SingleSelectCtrl } from '@/components/general/select'
import { PencilSquareIcon, UserPlusIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { type AssignRole, useRoleOptions } from '@/components/role-chip'
import { UserSelectCtrl } from '@/components/user-select'
import { parseAction } from '@/lib/action/action-client'
import { scUpsertCommandTargetMember, type UpsertCommandTargetMemberIn } from '@/lib/schema/schema'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import {
  addCommandTargetMemberAction,
  type GetCommandTargetAssignmentsReturnType,
  updateCommandTargetMemberRoleAction,
} from '../server'

type Assignments = NonNullable<GetCommandTargetAssignmentsReturnType>

/**
 * メンバー追加モーダル。ユーザーとロールを選んで直接メンバーを 1 行作る。
 *
 * 候補は「まだ直接メンバーではないユーザー」。グループ経由のユーザーも候補に含まれ、
 * 選ぶと直接ロールが付く(一覧の `via` が group から direct へ変わる)。
 */
export const AddMemberModal: FC<ModalBaseProps & { targetKey: string; assignments: Assignments }> = ({
  state,
  reload,
  targetKey,
  assignments,
}) => {
  const { t, fet } = useLocale()
  const roleOptions = useRoleOptions()

  const assigned = new Set(assignments.memberUserIds)
  const userOptions = assignments.userOptions.filter((user) => !assigned.has(user.id))

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<UpsertCommandTargetMemberIn>({
    resolver: zodResolver(scUpsertCommandTargetMember),
    mode: 'onChange',
    defaultValues: { targetKey, userId: '', role: 'member' },
  })

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        await parseAction(addCommandTargetMemberAction(req))
        const target = assignments.userOptions.find((user) => user.id === req.userId)
        notify.success(t('msg_added_target', { target: target?.name ?? '' }))
        reload()
        state.close()
      })}
      title={{ text: t('add_member'), icon: <UserPlusIcon /> }}
      submit={{ isPending: isSubmitting }}
    >
      <GridBox>
        <div className='col-span-12'>
          <UserSelectCtrl
            control={control}
            name='userId'
            options={userOptions}
            showEmail
            label={t('user')}
            placeholder={t('select_user')}
            emptyMessage={t('msg_no_matching_users')}
            errorMessage={fet(errors.userId)}
          />
        </div>
        <div className='col-span-12'>
          <SingleSelectCtrl
            control={control}
            name='role'
            groupOptions={roleOptions}
            label={t('role')}
            errorMessage={fet(errors.role)}
          />
          <p className='text-foreground-500 mt-1 text-xs'>{t('msg_command_owner_can_edit')}</p>
        </div>
      </GridBox>
    </FormModal>
  )
}

/**
 * メンバー更新モーダル。変更できるのはロールのみ。
 *
 * グループ経由メンバー(role が null)を対象にした場合は直接ロールの付与になる。
 */
export const UpdateMemberRoleModal: FC<
  ModalBaseProps & { targetKey: string; target: { id: string; name: string; role: AssignRole | null } }
> = ({ state, reload, targetKey, target }) => {
  const { t, fet } = useLocale()
  const roleOptions = useRoleOptions()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<UpsertCommandTargetMemberIn>({
    resolver: zodResolver(scUpsertCommandTargetMember),
    mode: 'onChange',
    defaultValues: { targetKey, userId: target.id, role: target.role ?? 'member' },
  })

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        await parseAction(updateCommandTargetMemberRoleAction(req))
        notify.success(t('msg_updated_target', { target: target.name }))
        reload()
        state.close()
      })}
      title={{ text: t('update_member'), icon: <PencilSquareIcon /> }}
      submit={{ isPending: isSubmitting }}
    >
      <GridBox>
        <div className='col-span-12'>
          <SingleSelectCtrl
            control={control}
            name='role'
            groupOptions={roleOptions}
            label={t('role')}
            errorMessage={fet(errors.role)}
          />
          <p className='text-foreground-500 mt-1 text-xs'>{t('msg_command_owner_can_edit')}</p>
        </div>
      </GridBox>
    </FormModal>
  )
}
