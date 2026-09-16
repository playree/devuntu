'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { PagingList } from '@/components/general/paging'
import { NoticePanel } from '@/components/general/panel'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon } from '@/components/icon'
import { RoleChip } from '@/components/role-chip'
import { useLocale } from '@/locale/client'
import { Table } from '@heroui/react'
import { FC } from 'react'
import { type GetCommandTargetMembersReturnType } from './server'

type CommandTargetMemberItem = NonNullable<GetCommandTargetMembersReturnType>[number]

/**
 * ターゲットにアサインされたユーザーの一覧。
 *
 * この画面からは変更できない(アサインの操作は管理者だけで、`/admin/commands/[targetId]` から行う)。
 * オーナーが「今このターゲットを誰が使えるか」を確かめられるようにするための表示。
 */
export const TargetMembers: FC<{ pagingList: PagingList<CommandTargetMemberItem> }> = ({ pagingList }) => {
  const { t } = useLocale()

  return (
    <FlexCol>
      <ContentHeader>
        <MultiButton isIconOnly tooltip={t('reload')} onPress={() => pagingList.reload()}>
          <ArrowPathIcon />
        </MultiButton>
      </ContentHeader>

      <MultiTable
        ariaLabel='command target member list'
        pagingList={pagingList}
        isSmart
        columns={[
          { id: 'name', name: t('name'), isRowHeader: true, allowsSorting: true, minWidth: 100 },
          { id: 'email', name: t('email'), allowsSorting: true, minWidth: 140, defaultWidth: '2fr' },
          { id: 'role', name: t('role'), allowsSorting: true, minWidth: 80 },
          { id: 'via', name: t('via'), allowsSorting: true, minWidth: 80 },
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
          </Table.Row>
        )}
      </MultiTable>

      <NoticePanel className='text-xs' status='warning'>
        {t('msg_command_assign_admin_only')}
      </NoticePanel>
    </FlexCol>
  )
}
