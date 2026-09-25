'use client'

import { ActionCell } from '@/components/action-cell'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { useModalState } from '@/components/general/modal'
import { PagingList } from '@/components/general/paging'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, PencilSquareIcon, UserPlusIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { RoleChip } from '@/components/role-chip'
import { parseAction } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { ButtonGroup, Table } from '@heroui/react'
import { FC } from 'react'
import {
  type GetCommandTargetAssignmentsReturnType,
  type GetCommandTargetMembersReturnType,
  removeCommandTargetMemberAction,
} from '../server'
import { AddMemberModal, UpdateMemberRoleModal } from './modals'

type Assignments = NonNullable<GetCommandTargetAssignmentsReturnType>
type CommandTargetMemberItem = NonNullable<GetCommandTargetMembersReturnType>[number]

/**
 * ターゲットのメンバーの一覧(テーブル)と、追加 / ロール変更 / 削除。
 *
 * 一覧はグループ経由のメンバーも含む。グループ経由のメンバーは行を持たないためロールが空欄で、
 * 削除もできない(外すにはグループアサインの設定を変える)。
 * 編集(ロール変更)は直接ロールの付与になるので、グループ経由でも実行できる。
 */
export const TargetMembers: FC<{
  targetKey: string
  assignments: Assignments
  reloadAssignments: () => void
  pagingList: PagingList<CommandTargetMemberItem>
}> = ({ targetKey, assignments, reloadAssignments, pagingList }) => {
  const { t } = useLocale()
  const addModalState = useModalState()
  const updateModalState = useModalState<CommandTargetMemberItem>()

  // アサインの選択肢(候補ユーザー)も追加後に変わるため、一覧と一緒に取り直す
  const reload = () => {
    reloadAssignments()
    pagingList.reload()
  }

  return (
    <FlexCol>
      <ContentHeader>
        <MultiButton
          isIconOnly
          tooltip={t('add_member')}
          icon={<UserPlusIcon />}
          onPress={() => addModalState.open()}
        />
        <MultiButton isIconOnly tooltip={t('reload')} icon={<ArrowPathIcon />} onPress={() => pagingList.reload()}>
          <ButtonGroup.Separator />
        </MultiButton>
      </ContentHeader>

      <MultiTable
        aria-label='command target member list'
        pagingList={pagingList}
        isSmart
        columns={[
          { id: 'name', name: t('name'), isRowHeader: true, allowsSorting: true, minWidth: 100 },
          { id: 'email', name: t('email'), allowsSorting: true, minWidth: 140, defaultWidth: '2fr' },
          { id: 'role', name: t('role'), allowsSorting: true, minWidth: 80 },
          { id: 'via', name: t('via'), allowsSorting: true, minWidth: 80 },
          { id: 'action', name: t('action'), allowsSorting: false, defaultWidth: 100 },
        ]}
      >
        {(item) => (
          <Table.Row key={item.id} id={item.id}>
            <Table.Cell className='truncate'>{item.name}</Table.Cell>
            <Table.Cell className='truncate font-mono text-xs'>{item.email}</Table.Cell>
            <Table.Cell /* グループ経由のみのメンバーは直接ロールを持たない */>
              {item.role ? <RoleChip role={item.role} /> : '-'}
            </Table.Cell>
            <Table.Cell>{item.via === 'group' ? t('group') : t('direct')}</Table.Cell>
            <ActionCell
              items={[
                {
                  template: 'none',
                  key: 'edit',
                  icon: <PencilSquareIcon />,
                  tooltip: t('update'),
                  onPress: () => {
                    updateModalState.open(item)
                  },
                },
                // グループ経由のメンバーは外す対象の行が無いので削除させない
                ...(item.via === 'member'
                  ? ([
                      {
                        template: 'delete',
                        target: item.name,
                        action: async () => {
                          await parseAction(removeCommandTargetMemberAction({ targetKey, userId: item.id }))
                          notify.success(t('msg_deleted_target', { target: item.name }))
                          reload()
                        },
                      },
                    ] as const)
                  : []),
              ]}
            />
          </Table.Row>
        )}
      </MultiTable>

      {addModalState.isOpen && (
        <AddMemberModal
          state={addModalState}
          reload={reload}
          key={addModalState.key}
          targetKey={targetKey}
          assignments={assignments}
        />
      )}

      {updateModalState.target && (
        <UpdateMemberRoleModal
          state={updateModalState}
          reload={reload}
          key={updateModalState.key}
          targetKey={targetKey}
          target={updateModalState.target}
        />
      )}
    </FlexCol>
  )
}
