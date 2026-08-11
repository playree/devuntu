'use client'

import { MultiButton } from '@/components/general/button'
import { GridBox } from '@/components/general/grid'
import { FormModal, ModalBaseProps } from '@/components/general/modal'
import { SingleSelectCtrl } from '@/components/general/select'
import { CheckIcon, PencilSquareIcon, UserPlusIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { useRoleOptions } from '@/components/ticket/ticket-chip'
import { parseAction } from '@/lib/action-client'
import { scUpsertBoardMember, UpsertBoardMemberIn } from '@/lib/schema'
import type { BoardRole } from '@/lib/task'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { addBoardMember, GetBoardAssignmentsReturnType, updateBoardMemberRole } from './server'

type Assignments = NonNullable<GetBoardAssignmentsReturnType>

/**
 * メンバー追加モーダル。ユーザーとロールを選んで直接メンバー(BoardMember)を 1 行作る。
 *
 * 候補は「まだ直接メンバーではないユーザー」。グループ経由のユーザーも候補に含まれ、
 * 選ぶと直接ロールが付く(一覧の `via` が group から direct へ変わる)。
 */
export const AddMemberModal: FC<ModalBaseProps & { boardId: string; assignments: Assignments }> = ({
  state,
  reload,
  boardId,
  assignments,
}) => {
  const { t, fet } = useLocale()
  const roleOptions = useRoleOptions()

  const assignedIds = new Set([...assignments.ownerIds, ...assignments.memberIds])
  const userOptions = Object.fromEntries(
    Object.entries(assignments.userOptions).filter(([userId]) => !assignedIds.has(userId)),
  )

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<UpsertBoardMemberIn>({
    resolver: zodResolver(scUpsertBoardMember),
    mode: 'onChange',
    defaultValues: {
      id: boardId,
      userId: '',
      role: 'member',
    },
  })

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        await parseAction(addBoardMember(req))
        notify.success(t('msg_added_target', { target: assignments.userOptions[req.userId] ?? '' }))
        reload()
        state.close()
      })}
      title={{ text: t('add_member'), icon: <UserPlusIcon /> }}
      footer={
        <>
          <MultiButton slot='close' variant='ghost'>
            {t('cancel')}
          </MultiButton>
          <MultiButton type='submit' icon={<CheckIcon />} isPending={isSubmitting}>
            {t('ok')}
          </MultiButton>
        </>
      }
    >
      <GridBox>
        <div className='col-span-12'>
          <SingleSelectCtrl
            control={control}
            name='userId'
            groupOptions={userOptions}
            label={t('user')}
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
  ModalBaseProps & { boardId: string; target: { id: string; name: string; role: BoardRole | null } }
> = ({ state, reload, boardId, target }) => {
  const { t, fet } = useLocale()
  const roleOptions = useRoleOptions()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<UpsertBoardMemberIn>({
    resolver: zodResolver(scUpsertBoardMember),
    mode: 'onChange',
    defaultValues: {
      id: boardId,
      userId: target.id,
      role: target.role ?? 'member',
    },
  })

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        await parseAction(updateBoardMemberRole(req))
        notify.success(t('msg_updated_target', { target: target.name }))
        reload()
        state.close()
      })}
      title={{ text: t('update_member'), icon: <PencilSquareIcon /> }}
      footer={
        <>
          <MultiButton slot='close' variant='ghost'>
            {t('cancel')}
          </MultiButton>
          <MultiButton type='submit' icon={<CheckIcon />} isPending={isSubmitting}>
            {t('ok')}
          </MultiButton>
        </>
      }
    >
      <GridBox>
        <div className='col-span-12'>
          <SingleSelectCtrl // 対象ユーザーは変更させない(別のメンバーを編集したい場合は一覧から開き直す)
            control={control}
            name='userId'
            groupOptions={{ [target.id]: target.name }}
            label={t('user')}
            isDisabled
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
        </div>
        <div className='col-span-12 text-xs text-gray-500'>{t('msg_owner_required')}</div>
      </GridBox>
    </FormModal>
  )
}
