'use client'

import { GridBox } from '@/components/general/grid'
import { FormModal, ModalBaseProps } from '@/components/general/modal'
import { SingleSelectCtrl } from '@/components/general/select'
import { PencilSquareIcon, UserPlusIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { type AssignRole, useRoleOptions } from '@/components/role-chip'
import { UserSelectCtrl, type UserSelectOption } from '@/components/user-select'
import { parseAction } from '@/lib/action/action-client'
import { type AssignMember, scAssignMember } from '@/lib/schema/schema-board'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'

/** 保存に使う Server Action の戻り値。parseAction に渡せる形 */
export type ActionResult = Parameters<typeof parseAction>[0]

/**
 * メンバーの追加 / ロール変更モーダル。
 *
 * - target 無し: candidates からユーザーを選んで追加する
 * - target 有り: そのユーザーのロールだけを変更する(グループ経由で role が null なら直接ロールの付与になる)
 *
 * hasRole が false のときはロールの選択欄を出さない(承認者のようにロールの概念が無いアサイン向け)。
 */
export const AssignMemberModal: FC<
  ModalBaseProps & {
    title: string
    candidates: UserSelectOption[]
    target?: { id: string; name: string; role?: AssignRole | null }
    hasRole: boolean
    /** ロール欄の下に出す補足 */
    roleNote?: string
    onSave: (req: AssignMember) => ActionResult
  }
> = ({ state, reload, title, candidates, target, hasRole, roleNote, onSave }) => {
  const { t, fet } = useLocale()
  const roleOptions = useRoleOptions()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<AssignMember>({
    resolver: zodResolver(scAssignMember),
    mode: 'onChange',
    defaultValues: { userId: target?.id ?? '', role: target?.role ?? 'member' },
  })

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        await parseAction(onSave(req))
        if (target) {
          notify.success(t('msg_updated_target', { target: target.name }))
        } else {
          const user = candidates.find((user) => user.id === req.userId)
          notify.success(t('msg_added_target', { target: user?.name ?? '' }))
        }
        reload()
        state.close()
      })}
      title={{ text: title, icon: target ? <PencilSquareIcon /> : <UserPlusIcon /> }}
      submit={{ isPending: isSubmitting }}
    >
      <GridBox>
        <div className='col-span-12'>
          {target ? (
            <SingleSelectCtrl // 対象ユーザーは変更させない(別のメンバーを編集したい場合は一覧から開き直す)
              control={control}
              name='userId'
              groupOptions={{ [target.id]: target.name }}
              label={t('user')}
              isDisabled
            />
          ) : (
            <UserSelectCtrl
              control={control}
              name='userId'
              options={candidates}
              showEmail
              label={t('user')}
              placeholder={t('select_user')}
              emptyMessage={t('msg_no_matching_users')}
              errorMessage={fet(errors.userId)}
            />
          )}
        </div>
        {hasRole && (
          <div className='col-span-12'>
            <SingleSelectCtrl
              control={control}
              name='role'
              groupOptions={roleOptions}
              label={t('role')}
              errorMessage={fet(errors.role)}
            />
            {roleNote && <p className='text-muted mt-1 text-xs'>{roleNote}</p>}
          </div>
        )}
      </GridBox>
    </FormModal>
  )
}
