'use client'

import { ActionCell } from '@/components/action-cell'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { useModalState } from '@/components/general/modal'
import { PagingList } from '@/components/general/paging'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { PencilSquareIcon, UserPlusIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { ReloadButton } from '@/components/reload-button'
import { type AssignRole, RoleChip } from '@/components/role-chip'
import { type UserSelectOption } from '@/components/user-select'
import { parseAction } from '@/lib/action/action-client'
import { type AssignMember } from '@/lib/schema/schema-board'
import { useLocale } from '@/locale/client'
import { Table } from '@heroui/react'
import { type ActionResult, AssignMemberModal } from './assign-member-modal'

/** 一覧の 1 行。via が 'group' の行はグループ経由で、外す対象の行(直接アサイン)を持たない */
export type AssignmentMember = {
  id: string
  name: string
  email: string
  via: string
  role?: AssignRole | null
}

/** 編集の操作。渡さない場合は一覧だけを見せる */
export type AssignmentManage = {
  /** 追加ボタンとモーダルの見出し */
  addLabel: string
  /** すべての候補。すでに直接アサインされているユーザーは assignedUserIds で除く */
  userOptions: UserSelectOption[]
  assignedUserIds: string[]
  add: (req: AssignMember) => ActionResult
  /** 渡さないとロール変更の操作を出さない */
  updateRole?: (req: AssignMember) => ActionResult
  remove: (userId: string) => ActionResult
  /** モーダルのロール欄の下に出す補足 */
  roleNote?: string
}

/**
 * ユーザー単位のアサインの一覧(テーブル)と、追加 / ロール変更 / 削除。行操作ごとに即時反映する。
 *
 * 一覧はグループ経由のメンバーも含む。グループ経由のメンバーは直接アサインの行を持たないため
 * ロールが空欄で、削除もできない(外すにはグループアサインの設定を変える)。
 * ロール変更は直接ロールの付与になるので、グループ経由でも実行できる。
 *
 * グループの保存と合わせてリロードできるよう、`usePagingList` の呼び出しは親で行い、
 * ここでは結果だけを受け取る。
 */
export const AssignmentMembers = <T extends AssignmentMember>({
  'aria-label': ariaLabel,
  hasRole,
  pagingList,
  reloadAssignments,
  manage,
}: {
  'aria-label': string
  /** ロール列を出す */
  hasRole: boolean
  pagingList: PagingList<T>
  reloadAssignments: () => void
  manage?: AssignmentManage
}) => {
  const { t } = useLocale()
  const addModalState = useModalState()
  const updateModalState = useModalState<T>()

  // 追加の候補も変わるため、一覧と一緒に取り直す
  const reload = () => {
    reloadAssignments()
    pagingList.reload()
  }

  const assigned = new Set(manage?.assignedUserIds)
  const candidates = manage?.userOptions.filter((user) => !assigned.has(user.id)) ?? []
  const updateRole = manage?.updateRole

  return (
    <FlexCol>
      <ContentHeader>
        {manage && (
          <MultiButton
            isIconOnly
            tooltip={manage.addLabel}
            icon={<UserPlusIcon />}
            onPress={() => addModalState.open()}
          />
        )}
        <ReloadButton onReload={reload} hasSeparator={!!manage} />
      </ContentHeader>

      <MultiTable
        aria-label={ariaLabel}
        pagingList={pagingList}
        isSmart
        columns={[
          { id: 'name', name: t('name'), isRowHeader: true, allowsSorting: true, minWidth: 100 },
          { id: 'email', name: t('email'), allowsSorting: true, minWidth: 140, defaultWidth: '2fr' },
          ...(hasRole ? [{ id: 'role', name: t('role'), allowsSorting: true, minWidth: 80 }] : []),
          { id: 'via', name: t('via'), allowsSorting: true, minWidth: 70 },
          { id: 'action', name: t('action'), allowsSorting: false, defaultWidth: updateRole ? 100 : 60 },
        ]}
      >
        {(item) => (
          <Table.Row key={item.id} id={item.id}>
            <Table.Cell className='truncate'>{item.name}</Table.Cell>
            <Table.Cell className='truncate font-mono text-xs'>{item.email}</Table.Cell>
            {hasRole && (
              <Table.Cell /* グループ経由のみのメンバーは直接ロールを持たない */>
                {item.role ? <RoleChip value={item.role} /> : '-'}
              </Table.Cell>
            )}
            <Table.Cell>{item.via === 'group' ? t('group') : t('direct')}</Table.Cell>
            <ActionCell
              items={[
                ...(updateRole
                  ? [
                      {
                        template: 'none',
                        key: 'edit',
                        icon: <PencilSquareIcon />,
                        tooltip: t('update'),
                        onPress: () => updateModalState.open(item),
                      } as const,
                    ]
                  : []),
                ...(manage && item.via !== 'group'
                  ? [
                      {
                        template: 'delete',
                        target: item.name,
                        action: async () => {
                          await parseAction(manage.remove(item.id))
                          notify.success(t('msg_deleted_target', { target: item.name }))
                          reload()
                        },
                      } as const,
                    ]
                  : []),
              ]}
            />
          </Table.Row>
        )}
      </MultiTable>

      {manage && (
        <AssignMemberModal
          state={addModalState}
          reload={reload}
          key={addModalState.key}
          title={manage.addLabel}
          candidates={candidates}
          hasRole={hasRole}
          roleNote={manage.roleNote}
          onSave={manage.add}
        />
      )}
      {updateRole && updateModalState.target && (
        <AssignMemberModal
          state={updateModalState}
          reload={reload}
          key={updateModalState.key}
          title={t('update_member')}
          candidates={candidates}
          target={updateModalState.target}
          hasRole={hasRole}
          roleNote={manage?.roleNote}
          onSave={updateRole}
        />
      )}
    </FlexCol>
  )
}
