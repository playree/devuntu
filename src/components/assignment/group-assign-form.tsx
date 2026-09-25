'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { MultiSelectCtrl } from '@/components/general/select'
import { CheckIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action/action-client'
import { type AssignGroups, scAssignGroups } from '@/lib/schema/schema-board'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC, ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { type ActionResult } from './assign-member-modal'

/**
 * グループ単位のアサイン。複数選択して保存ボタンでまとめて反映する。
 * ユーザー単位のアサインは AssignmentMembers の一覧から行う。
 *
 * 再取得しても useForm の defaultValues は追従しないので、呼び出し側で
 * `key={groupIds.join(',')}` を付け、アサインが変わったら作り直すこと。
 */
export const GroupAssignForm: FC<{
  label: string
  groupOptions: Record<string, string>
  groupIds: string[]
  /** 選択欄の下に出す補足 */
  notice?: ReactNode
  /** 保存ボタンの左に出す表示 */
  status?: ReactNode
  onSave: (groupIds: string[]) => ActionResult
  reload: () => void
}> = ({ label, groupOptions, groupIds, notice, status, onSave, reload }) => {
  const { t } = useLocale()

  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<AssignGroups>({
    resolver: zodResolver(scAssignGroups),
    mode: 'onChange',
    defaultValues: { groupIds },
  })

  return (
    <form
      onSubmit={handleSubmit(async (req) => {
        await parseAction(onSave(req.groupIds))
        notify.success(t('msg_saved'))
        reset(req)
        reload()
      })}
    >
      <FlexCol isSmart>
        <MultiSelectCtrl control={control} name='groupIds' groupOptions={groupOptions} label={label} />
        {notice}
        <div className='flex items-center gap-2'>
          {status}
          <MultiButton className='ml-auto' type='submit' icon={<CheckIcon />} isPending={isSubmitting}>
            {t('save')}
          </MultiButton>
        </div>
      </FlexCol>
    </form>
  )
}
