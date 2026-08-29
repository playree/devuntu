'use client'

import { MultiButton } from '@/components/general/button'
import { GridBox } from '@/components/general/grid'
import { FormModal, ModalBaseProps } from '@/components/general/modal'
import { CheckIcon, UserPlusIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import type { UserSelectOption } from '@/components/user-select'
import { UserSelectCtrl } from '@/components/user-select'
import { parseAction } from '@/lib/action/action-client'
import { AgentApproverUser, scAgentApproverUser } from '@/lib/schema/schema'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { addAgentApproverUser } from './server'

/**
 * 承認ユーザー追加モーダル。ロールの概念が無いためユーザー選択のみ。
 * 候補はすでに承認ユーザーになっているユーザーを除外したもの
 */
export const AddAgentApproverModal: FC<
  ModalBaseProps & { agentId: string; userOptions: UserSelectOption[]; assignedUserIds: string[] }
> = ({ state, reload, agentId, userOptions, assignedUserIds }) => {
  const { t, fet } = useLocale()

  const assignedIds = new Set(assignedUserIds)
  const candidateOptions = userOptions.filter((user) => !assignedIds.has(user.id))

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<AgentApproverUser>({
    resolver: zodResolver(scAgentApproverUser),
    mode: 'onChange',
    defaultValues: { id: agentId, userId: '' },
  })

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        await parseAction(addAgentApproverUser(req))
        const target = userOptions.find((user) => user.id === req.userId)
        notify.success(t('msg_added_target', { target: target?.name ?? '' }))
        reload()
        state.close()
      })}
      title={{ text: t('add_agent_approver_user'), icon: <UserPlusIcon /> }}
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
          <UserSelectCtrl
            control={control}
            name='userId'
            options={candidateOptions}
            showEmail
            label={t('user')}
            placeholder={t('select_user')}
            emptyMessage={t('msg_no_matching_users')}
            errorMessage={fet(errors.userId)}
          />
        </div>
      </GridBox>
    </FormModal>
  )
}
