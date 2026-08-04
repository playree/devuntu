'use client'

import { ActionCell } from '@/components/action-cell'
import { MultiButton } from '@/components/general/button'
import { OnOffChip } from '@/components/general/chip'
import { FlexCol } from '@/components/general/flex'
import { useModalState } from '@/components/general/modal'
import { usePagingList } from '@/components/general/paging'
import { SwitchItem } from '@/components/general/switch-ctrl'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, Cog6ToothIcon, PlusIcon, ViewColumnsIcon } from '@/components/icon'
import { RoleChip, useBoardName } from '@/components/ticket/ticket-chip'
import { parseAction } from '@/lib/action-client'
import { useLocale } from '@/locale/client'
import { ButtonGroup, Table } from '@heroui/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FC } from 'react'
import { AddModal } from './modals'
import { getBoards } from './server'

export const BoardsClient: FC = () => {
  const { t } = useLocale()
  const router = useRouter()
  const boardName = useBoardName()
  const addModalState = useModalState()

  const list = usePagingList({
    load: async () => {
      const res = await parseAction(getBoards())
      return res ?? []
    },
    filter: {
      // usePagingList のフィルタ値は文字列のみなので '1' / '' で ON/OFF を表す
      init: { showArchived: '' },
      proc: (item, { showArchived }) => showArchived === '1' || !item.archived,
    },
    // プライベートを先頭に出したいのでサーバー側の並び(kind, name)をそのまま使う。
    // sort.init を渡すと usePagingList が load 時にクライアント側で並べ替えてしまうので指定しない
  })

  return (
    <FlexCol>
      <ContentHeader
        icon={<ViewColumnsIcon />}
        title={t('board')}
        extra={
          <SwitchItem // 既定ではアーカイブ済みを隠す。状態は setFilter が持つので useState は置かない
            id='show-archived'
            label={t('show_archived')}
            onChange={(isSelected) => list.setFilter({ showArchived: isSelected ? '1' : '' })}
          />
        }
      >
        <MultiButton isIconOnly tooltip={t('add_board')} onPress={() => addModalState.open()}>
          <PlusIcon />
        </MultiButton>
        <MultiButton isIconOnly tooltip={t('reload')} onPress={() => list.reload()}>
          <ButtonGroup.Separator />
          <ArrowPathIcon />
        </MultiButton>
      </ContentHeader>

      {list.total === 0 && <div className='px-1 text-sm text-gray-500'>{t('msg_no_boards')}</div>}

      <MultiTable
        ariaLabel='board list'
        pagingList={list}
        columns={[
          { id: 'name', name: t('name'), isRowHeader: true, allowsSorting: true, minWidth: 140, defaultWidth: '2fr' },
          { id: 'description', name: t('description'), allowsSorting: false, minWidth: 120, defaultWidth: '2fr' },
          { id: 'role', name: t('role'), allowsSorting: true, minWidth: 90 },
          { id: 'ticketCount', name: t('ticket_count'), allowsSorting: true, minWidth: 90 },
          { id: 'archived', name: t('archived'), allowsSorting: true, minWidth: 80 },
          { id: 'settings', name: t('settings'), allowsSorting: false, defaultWidth: 90 },
        ]}
      >
        {(item) => (
          <Table.Row key={item.id} id={item.id}>
            <Table.Cell>
              <div className='flex flex-col gap-0.5'>
                <Link // ボード名をかんばんへのリンクにする(操作列は置かない)
                  href={`/boards/${item.id}`}
                  className='truncate hover:underline'
                >
                  {boardName(item)}
                </Link>
                <span className='text-xs text-gray-500'>{item.kind === 'private' ? t('private') : t('team')}</span>
              </div>
            </Table.Cell>
            <Table.Cell className='truncate'>{item.description}</Table.Cell>
            <Table.Cell>
              <RoleChip role={item.role} />
            </Table.Cell>
            <Table.Cell className='font-mono text-xs'>
              {item.openCount} / {item.ticketCount}
            </Table.Cell>
            <Table.Cell>
              <OnOffChip isState={item.archived} isIconOnly />
            </Table.Cell>
            <ActionCell // 編集 / 削除 / アーカイブはボード設定ページに集約しているので、ここは設定への導線だけ
              items={[
                {
                  template: 'none',
                  key: 'settings',
                  icon: <Cog6ToothIcon />,
                  tooltip: t('board_settings'),
                  onPress: () => router.push(`/boards/${item.id}/settings`),
                },
              ]}
            />
          </Table.Row>
        )}
      </MultiTable>

      <AddModal state={addModalState} reload={list.reload} key={addModalState.key} />
    </FlexCol>
  )
}
