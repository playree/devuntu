'use client'

import { ActionCell } from '@/components/action-cell'
import { MultiButton } from '@/components/general/button'
import { OnOffChip } from '@/components/general/chip'
import { FlexCol } from '@/components/general/flex'
import { useModalState } from '@/components/general/modal'
import { usePagingList } from '@/components/general/paging'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, PencilSquareIcon, PlusIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action-client'
import { UpdateOidcClient } from '@/lib/schema'
import { useLocale } from '@/locale/client'
import { ButtonGroup, Table } from '@heroui/react'
import { FC } from 'react'
import { AddModal, UpdateModal } from './modals'
import { deleteOidcClient, getOidcClients } from './server'

/** 管理画面から登録したクライアント。追加・更新・削除ができる */
export const ManualOidcClients: FC<{ baseUrl: string }> = ({ baseUrl }) => {
  const { t } = useLocale()
  const addModalState = useModalState()
  const updateModalState = useModalState<UpdateOidcClient & { requirePkce: boolean }>()

  const list = usePagingList({
    load: async () => {
      const res = await parseAction(getOidcClients())
      return res ?? []
    },
    sort: {
      init: { column: 'clientName', direction: 'ascending' },
    },
  })

  return (
    <FlexCol>
      <ContentHeader className='text-foreground'>
        <MultiButton isIconOnly tooltip={t('add_client')} onPress={() => addModalState.open()}>
          <PlusIcon />
        </MultiButton>
        <MultiButton isIconOnly tooltip={t('reload')} onPress={() => list.reload()}>
          <ButtonGroup.Separator />
          <ArrowPathIcon />
        </MultiButton>
      </ContentHeader>

      <MultiTable
        ariaLabel='oidc client list'
        pagingList={list}
        columns={[
          {
            id: 'clientName',
            name: t('client_name'),
            isRowHeader: true,
            allowsSorting: true,
            minWidth: 120,
            defaultWidth: '1fr',
          },
          { id: 'clientId', name: t('client_id'), allowsSorting: true, minWidth: 200, defaultWidth: '2fr' },
          { id: 'skipConsent', name: t('skip_consent'), allowsSorting: false, minWidth: 100 },
          { id: 'requirePkce', name: t('require_pkce'), allowsSorting: false, minWidth: 100 },
          { id: 'action', name: t('action'), allowsSorting: false, defaultWidth: 100 },
        ]}
      >
        {(item) => (
          <Table.Row key={item.clientId} id={item.clientId}>
            <Table.Cell>{item.clientName}</Table.Cell>
            <Table.Cell className='font-mono text-xs'>{item.clientId}</Table.Cell>
            <Table.Cell>
              <OnOffChip isState={item.skipConsent} />
            </Table.Cell>
            <Table.Cell>
              <OnOffChip isState={item.requirePkce} />
            </Table.Cell>
            <ActionCell
              items={[
                // 更新は better-auth 側で所有者チェックが入るため、自分が登録したものだけ出す
                ...(item.isOwn
                  ? [
                      {
                        template: 'none' as const,
                        key: 'edit',
                        icon: <PencilSquareIcon />,
                        tooltip: t('update'),
                        onPress: () => {
                          updateModalState.open(item)
                        },
                      },
                    ]
                  : []),
                {
                  template: 'delete',
                  target: item.clientName ?? '',
                  action: async () => {
                    await parseAction(deleteOidcClient({ clientId: item.clientId }))
                    notify.success(t('msg_deleted_target', { target: item.clientName }))
                    list.reload()
                  },
                },
              ]}
            />
          </Table.Row>
        )}
      </MultiTable>

      <AddModal state={addModalState} reload={list.reload} key={addModalState.key} baseUrl={baseUrl} />
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
