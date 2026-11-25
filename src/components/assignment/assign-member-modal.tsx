'use client'

import { GridBox } from '@/components/general/grid'
import { FormModal, ModalBaseProps } from '@/components/general/modal'
import { SingleSelectCtrl } from '@/components/general/select'
import { PencilSquareIcon, UserPlusIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { type AssignRole, RoleChip, useRoleOptions } from '@/components/role-chip'
import { UserSelectCtrl, type UserSelectOption } from '@/components/user-select'
import { parseAction } from '@/lib/action/action-client'
import { scAssignMember } from '@/lib/schema/schema-board'
import { el } from '@/locale'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

/** 保存に使う Server Action の戻り値。parseAction に渡せる形 */
export type ActionResult = Parameters<typeof parseAction>[0]

/** 追加 / ロール変更の入力 */
export type AssignMemberRequest<R extends string = AssignRole> = { userId: string; role: R }

/** ロールの種類(選択肢・Chip・追加時の既定値)。ドメインごとにロールが違うため差し替えられるようにする */
export type AssignRoles<R extends string> = {
  options: Record<R, string>
  Chip: FC<{ value: R }>
  defaultRole: R
}

/** 渡されたロールを使い、無ければボードのロール(owner / member)にする */
export const useAssignRoles = <R extends string>(roles: AssignRoles<R> | undefined): AssignRoles<R> => {
  const boardOptions = useRoleOptions()
  return roles ?? ({ options: boardOptions, Chip: RoleChip, defaultRole: 'member' } as unknown as AssignRoles<R>)
}

// ロールの値はドメインごとに違うので、ここでは選択済みかだけを見る(値の妥当性は Server Action のスキーマで検証する)
const scAssignMemberForm = scAssignMember.extend({ role: z.string().min(1, el('@required_field')) })

/**
 * メンバーの追加 / ロール変更モーダル。
 *
 * - target 無し: candidates からユーザーを選んで追加する
 * - target 有り: そのユーザーのロールだけを変更する(グループ経由で role が null なら直接ロールの付与になる)
 *
 * hasRole が false のときはロールの選択欄を出さない(承認者のようにロールの概念が無いアサイン向け)。
 */
export const AssignMemberModal = <R extends string>({
  state,
  reload,
  title,
  candidates,
  target,
  hasRole,
  roles,
  roleNote,
  onSave,
}: ModalBaseProps & {
  title: string
  candidates: UserSelectOption[]
  target?: { id: string; name: string; role?: R | null }
  hasRole: boolean
  roles: AssignRoles<R>
  /** ロール欄の下に出す補足 */
  roleNote?: string
  onSave: (req: AssignMemberRequest<R>) => ActionResult
}) => {
  const { t, fet } = useLocale()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<z.infer<typeof scAssignMemberForm>>({
    resolver: zodResolver(scAssignMemberForm),
    mode: 'onChange',
    defaultValues: { userId: target?.id ?? '', role: target?.role ?? roles.defaultRole },
  })

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        await parseAction(onSave({ userId: req.userId, role: req.role as R }))
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
              groupOptions={roles.options}
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
