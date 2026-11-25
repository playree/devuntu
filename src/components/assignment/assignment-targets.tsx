'use client'

import { ActionCell } from '@/components/action-cell'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { GridBox } from '@/components/general/grid'
import { FormModal, type ModalBaseProps, useModalState } from '@/components/general/modal'
import { SingleSelectCtrl } from '@/components/general/select'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { PencilSquareIcon, PlusIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { ReloadButton } from '@/components/reload-button'
import { parseAction } from '@/lib/action/action-client'
import { el } from '@/locale'
import { useLocale } from '@/locale/client'
import { Table } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { type ActionResult, type AssignRoles } from './assign-member-modal'

/** 一覧の 1 行(グループやボードなど、ユーザー以外の割り当て先) */
export type AssignmentTarget<R extends string> = { id: string; name: string; role: R }

export type AssignTargetRequest<R extends string> = { targetId: string; role: R }

// ロールの値はドメインごとに違うので、ここでは選択済みかだけを見る(値の妥当性は Server Action のスキーマで検証する)
const scAssignTargetForm = z.object({
  targetId: z.string().min(1, el('@required_field')),
  role: z.string().min(1, el('@required_field')),
})
type AssignTargetForm = z.infer<typeof scAssignTargetForm>

/**
 * ロール付きの割り当て(グループ・ボードなど)の一覧と、追加 / ロール変更 / 削除。行操作ごとに即時反映する。
 * ユーザーの割り当ては、グループ経由のメンバーも見せる AssignmentMembers を使う。
 */
export const AssignmentTargets = <R extends string>({
  'aria-label': ariaLabel,
  label,
  addLabel,
  items,
  options,
  roles,
  emptyContent,
  add,
  updateRole,
  remove,
  reload,
}: {
  'aria-label': string
  /** 割り当て先の種類(一覧の列名・モーダルの選択欄) */
  label: string
  /** 追加ボタンとモーダルの見出し */
  addLabel: string
  items: AssignmentTarget<R>[]
  /** すべての候補(id → 表示名)。割り当て済みのものは除いて出す */
  options: Record<string, string>
  roles: AssignRoles<R>
  emptyContent?: string
  add: (req: AssignTargetRequest<R>) => ActionResult
  updateRole: (req: AssignTargetRequest<R>) => ActionResult
  remove: (targetId: string) => ActionResult
  reload: () => void
}) => {
  const { t } = useLocale()
  const addModalState = useModalState()
  const updateModalState = useModalState<AssignmentTarget<R>>()
  const { Chip: RoleChip } = roles

  const assigned = new Set(items.map((item) => item.id))
  const candidates = Object.fromEntries(Object.entries(options).filter(([id]) => !assigned.has(id)))

  return (
    <FlexCol>
      <ContentHeader>
        <MultiButton isIconOnly tooltip={addLabel} icon={<PlusIcon />} onPress={() => addModalState.open()} />
        <ReloadButton onReload={reload} />
      </ContentHeader>

      <MultiTable
        aria-label={ariaLabel}
        items={items}
        isSmart
        emptyContent={emptyContent}
        columns={[
          { id: 'name', name: label, isRowHeader: true, minWidth: 120, defaultWidth: '2fr' },
          { id: 'role', name: t('role'), minWidth: 80 },
          { id: 'action', name: t('action'), defaultWidth: 100 },
        ]}
      >
        {(item) => (
          <Table.Row key={item.id} id={item.id}>
            <Table.Cell className='truncate'>{item.name}</Table.Cell>
            <Table.Cell>
              <RoleChip value={item.role} />
            </Table.Cell>
            <ActionCell
              items={[
                {
                  template: 'none',
                  key: 'edit',
                  icon: <PencilSquareIcon />,
                  tooltip: t('update'),
                  onPress: () => updateModalState.open(item),
                },
                {
                  template: 'delete',
                  target: item.name,
                  action: async () => {
                    await parseAction(remove(item.id))
                    notify.success(t('msg_deleted_target', { target: item.name }))
                    reload()
                  },
                },
              ]}
            />
          </Table.Row>
        )}
      </MultiTable>

      <AssignTargetModal
        state={addModalState}
        reload={reload}
        key={addModalState.key}
        title={addLabel}
        label={label}
        options={candidates}
        roles={roles}
        onSave={add}
      />
      {updateModalState.target && (
        <AssignTargetModal
          state={updateModalState}
          reload={reload}
          key={updateModalState.key}
          title={t('update')}
          label={label}
          options={{ [updateModalState.target.id]: updateModalState.target.name }}
          target={updateModalState.target}
          roles={roles}
          onSave={updateRole}
        />
      )}
    </FlexCol>
  )
}

/** 割り当て先の追加(target 無し)/ ロール変更(target 有り。割り当て先は変えさせない) */
const AssignTargetModal = <R extends string>({
  state,
  reload,
  title,
  label,
  options,
  target,
  roles,
  onSave,
}: ModalBaseProps & {
  title: string
  label: string
  options: Record<string, string>
  target?: AssignmentTarget<R>
  roles: AssignRoles<R>
  onSave: (req: AssignTargetRequest<R>) => ActionResult
}) => {
  const { t, fet } = useLocale()
  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<AssignTargetForm>({
    resolver: zodResolver(scAssignTargetForm),
    mode: 'onChange',
    defaultValues: { targetId: target?.id ?? '', role: target?.role ?? roles.defaultRole },
  })

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        await parseAction(onSave({ targetId: req.targetId, role: req.role as R }))
        const name = options[req.targetId] ?? ''
        notify.success(target ? t('msg_updated_target', { target: name }) : t('msg_added_target', { target: name }))
        reload()
        state.close()
      })}
      title={{ text: title, icon: target ? <PencilSquareIcon /> : <PlusIcon /> }}
      submit={{ isPending: isSubmitting }}
    >
      <GridBox>
        <div className='col-span-12'>
          <SingleSelectCtrl
            control={control}
            name='targetId'
            groupOptions={options}
            label={label}
            isDisabled={!!target}
            errorMessage={fet(errors.targetId)}
          />
        </div>
        <div className='col-span-12'>
          <SingleSelectCtrl
            control={control}
            name='role'
            groupOptions={roles.options}
            label={t('role')}
            errorMessage={fet(errors.role)}
          />
        </div>
      </GridBox>
    </FormModal>
  )
}
