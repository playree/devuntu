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
import { RoleChip } from '@/components/ticket/ticket-chip'
import { parseAction } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { ButtonGroup, Table } from '@heroui/react'
import { FC } from 'react'
import { AddMemberModal, UpdateMemberRoleModal } from './modals'
import { GetBoardAssignmentsReturnType, GetBoardMembersReturnType, removeBoardMember } from './server'

type Assignments = NonNullable<GetBoardAssignmentsReturnType>
type BoardMemberItem = NonNullable<GetBoardMembersReturnType>[number]

/**
 * ボードメンバーの一覧(テーブル)と、追加 / ロール変更 / 削除。
 *
 * 一覧はグループ経由のメンバーも含む。グループ経由のメンバーは BoardMember 行を持たないため
 * ロールが空欄で、削除もできない(外すにはボードグループの設定を変える)。
 * 編集(ロール変更)は直接ロールの付与になるので、グループ経由でも実行できる。
 *
 * ボードグループの保存と合わせてリロードできるよう、`usePagingList` の呼び出しは
 * 親(client.tsx)側で行い、ここでは結果だけを受け取る(agent-run-history.tsx と同じ形)
 */
export const BoardMembers: FC<{
  boardId: string
  assignments?: Assignments
  reloadAssignments: () => void
  pagingList: PagingList<BoardMemberItem>
}> = ({ boardId, assignments, reloadAssignments, pagingList }) => {
  const { t } = useLocale()
  const addModalState = useModalState()
  const updateModalState = useModalState<BoardMemberItem>()

  // アサインの選択肢(候補ユーザー)も追加後に変わるため、一覧と一緒に取り直す
  const reload = () => {
    reloadAssignments()
    pagingList.reload()
  }

  return (
    <FlexCol>
      <ContentHeader>
        {assignments && (
          <MultiButton // manage 権限が無い場合はアサインを編集させない(assignments が渡ってこない)
            isIconOnly
            tooltip={t('add_member')}
            onPress={() => addModalState.open()}
          >
            <UserPlusIcon />
          </MultiButton>
        )}
        <MultiButton isIconOnly tooltip={t('reload')} onPress={() => pagingList.reload()}>
          {assignments && <ButtonGroup.Separator />}
          <ArrowPathIcon />
        </MultiButton>
      </ContentHeader>

      <MultiTable
        ariaLabel='board member list'
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
              items={
                assignments
                  ? [
                      {
                        template: 'none',
                        key: 'edit',
                        icon: <PencilSquareIcon />,
                        tooltip: t('update'),
                        onPress: () => {
                          updateModalState.open(item)
                        },
                      },
                      // グループ経由のメンバーは外す対象の行(BoardMember)が無いので削除させない
                      ...(item.via === 'member'
                        ? ([
                            {
                              template: 'delete',
                              target: item.name,
                              action: async () => {
                                await parseAction(removeBoardMember({ id: boardId, userId: item.id }))
                                notify.success(t('msg_deleted_target', { target: item.name }))
                                reload()
                              },
                            },
                          ] as const)
                        : []),
                    ]
                  : []
              }
            />
          </Table.Row>
        )}
      </MultiTable>

      {assignments && (
        <>
          <AddMemberModal
            state={addModalState}
            reload={reload}
            key={addModalState.key}
            boardId={boardId}
            assignments={assignments}
          />
          {updateModalState.target && (
            <UpdateMemberRoleModal
              state={updateModalState}
              reload={reload}
              key={updateModalState.key}
              boardId={boardId}
              target={updateModalState.target}
            />
          )}
        </>
      )}
    </FlexCol>
  )
}
