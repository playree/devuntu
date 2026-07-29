'use client'

import { ActionCell } from '@/components/action-cell'
import { MultiButton } from '@/components/general/button'
import { OnOffChip } from '@/components/general/chip'
import { FlexCol } from '@/components/general/flex'
import { useConfirmModal, useModalState } from '@/components/general/modal'
import { usePagingList } from '@/components/general/paging'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
  ViewColumnsIcon,
} from '@/components/icon'
import { notify } from '@/components/notify'
import { useBoardName } from '@/components/ticket/ticket-chip'
import { parseAction } from '@/lib/action-client'
import { useLocale } from '@/locale/client'
import { ButtonGroup, Chip, Table } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC } from 'react'
import { AddModal, UpdateModal } from './modals'
import { deleteBoard, getBoards, GetBoardsReturnType } from './server'

type Board = NonNullable<GetBoardsReturnType>[number]

export const BoardsClient: FC = () => {
  const { t } = useLocale()
  const router = useRouter()
  const boardName = useBoardName()
  const { confirmModal } = useConfirmModal()
  const addModalState = useModalState()
  const updateModalState = useModalState<Board>()

  const list = usePagingList({
    load: async () => {
      const res = await parseAction(getBoards())
      return res ?? []
    },
    // プライベートを先頭に出したいのでサーバー側の並び(kind, name)をそのまま使う
    sort: { init: { column: 'name', direction: 'ascending' } },
  })

  // ActionCell の delete テンプレートは文言が固定なので、ボード専用の確認文で自前に出す
  const remove = async (board: Board) => {
    const name = boardName(board)
    try {
      const ok = await confirmModal().confirm({
        title: t('confirm_deletion'),
        text: t('msg_confirm_delete_board', { target: name }),
        requireCheck: true,
        autoClose: false,
      })
      if (ok) {
        await parseAction(deleteBoard({ id: board.id }))
        notify.success(t('msg_deleted_target', { target: name }))
        list.reload()
      }
    } finally {
      confirmModal().close()
    }
  }

  return (
    <FlexCol>
      <ContentHeader icon={<ViewColumnsIcon />} title={t('board_manage')}>
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
          { id: 'role', name: t('owner'), allowsSorting: true, minWidth: 90 },
          { id: 'ticketCount', name: t('ticket_count'), allowsSorting: true, minWidth: 90 },
          { id: 'archived', name: t('archived'), allowsSorting: true, minWidth: 80 },
          { id: 'action', name: t('action'), allowsSorting: false, defaultWidth: 110 },
        ]}
      >
        {(item) => (
          <Table.Row key={item.id} id={item.id}>
            <Table.Cell>
              <div className='flex flex-col gap-0.5'>
                <span className='truncate'>{boardName(item)}</span>
                <span className='text-xs text-gray-500'>{item.kind === 'private' ? t('private') : t('team')}</span>
              </div>
            </Table.Cell>
            <Table.Cell className='truncate'>{item.description}</Table.Cell>
            <Table.Cell>
              <Chip variant='soft' color={item.role === 'owner' ? 'accent' : 'default'} size='sm'>
                <Chip.Label>{item.role === 'owner' ? t('owner') : t('member')}</Chip.Label>
              </Chip>
            </Table.Cell>
            <Table.Cell className='font-mono text-xs'>
              {item.openCount} / {item.ticketCount}
            </Table.Cell>
            <Table.Cell>
              <OnOffChip isState={item.archived} isIconOnly />
            </Table.Cell>
            <ActionCell
              items={[
                {
                  template: 'none',
                  key: 'open',
                  icon: <ArrowTopRightOnSquareIcon />,
                  tooltip: t('board'),
                  onPress: () => router.push(`/boards/${item.id}`),
                },
                // プライベートボードは 1 ユーザー 1 つの固定構成なので編集・削除させない
                ...(item.kind === 'team' && item.role === 'owner'
                  ? ([
                      {
                        template: 'none' as const,
                        key: 'edit',
                        icon: <PencilSquareIcon />,
                        tooltip: t('update'),
                        onPress: () => updateModalState.open(item),
                      },
                      {
                        template: 'none' as const,
                        key: 'delete',
                        icon: <TrashIcon />,
                        tooltip: t('delete'),
                        variant: 'danger-soft' as const,
                        onPress: () => remove(item),
                      },
                    ] as const)
                  : []),
              ]}
            />
          </Table.Row>
        )}
      </MultiTable>

      <AddModal state={addModalState} reload={list.reload} key={addModalState.key} />
      {updateModalState.target && (
        <UpdateModal
          state={updateModalState}
          reload={list.reload}
          key={updateModalState.key}
          target={updateModalState.target}
        />
      )}
    </FlexCol>
  )
}
