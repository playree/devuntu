'use client'

import { ActionCell } from '@/components/action-cell'
import { MultiButton } from '@/components/general/button'
import { OnOffChip } from '@/components/general/chip'
import { FlexCol } from '@/components/general/flex'
import { usePagingList } from '@/components/general/paging'
import { NoticePanel } from '@/components/general/panel'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, BoltSlashIcon, CheckIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action-client'
import { dayformat } from '@/lib/day'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { Table } from '@heroui/react'
import { FC } from 'react'
import { deleteOidcClient, getDynamicOidcClients, setOidcClientDisabled } from './server'

/**
 * 動的クライアント登録(RFC 7591)で登録されたクライアント。
 * MCP クライアントのインストールごとに増えるので、追加・更新は無く、無効化と削除だけを用意する。
 * クライアント名は自己申告なので、判断できるようリダイレクトURIも並べる。
 */
export const DynamicOidcClients: FC = () => {
  const { t } = useLocale()
  const tz = useUserTimezone()

  const list = usePagingList({
    load: async () => {
      const res = await parseAction(getDynamicOidcClients())
      return res ?? []
    },
    sort: {
      init: { column: 'createdAt', direction: 'descending' },
    },
  })

  return (
    <FlexCol>
      <ContentHeader className='text-foreground'>
        <MultiButton isIconOnly tooltip={t('reload')} onPress={() => list.reload()}>
          <ArrowPathIcon />
        </MultiButton>
      </ContentHeader>

      <MultiTable
        isSmart
        ariaLabel='dynamic oidc client list'
        pagingList={list}
        columns={[
          {
            id: 'clientName',
            name: t('client_name'),
            isRowHeader: true,
            allowsSorting: true,
            minWidth: 160,
            defaultWidth: '2fr',
          },
          { id: 'clientId', name: t('client_id'), allowsSorting: true, minWidth: 100 },
          { id: 'redirectUri', name: t('redirect_uri'), allowsSorting: false, minWidth: 100 },
          { id: 'enabled', name: t('enabled'), allowsSorting: false, minWidth: 100 },
          { id: 'createdAt', name: t('created_at'), allowsSorting: true, minWidth: 110 },
          { id: 'action', name: t('action'), allowsSorting: false, defaultWidth: 100 },
        ]}
      >
        {(item) => (
          <Table.Row key={item.clientId} id={item.clientId}>
            <Table.Cell>{item.clientName}</Table.Cell>
            <Table.Cell className='font-mono text-xs'>{item.clientId}</Table.Cell>
            <Table.Cell className='font-mono text-xs'>{item.redirectUri}</Table.Cell>
            <Table.Cell>
              <OnOffChip isState={item.enabled} />
            </Table.Cell>
            <Table.Cell className='font-mono text-xs'>{dayformat(item.createdAt, 'tz-simple', tz)}</Table.Cell>
            <ActionCell
              items={[
                {
                  template: 'none',
                  key: 'toggle',
                  icon: item.enabled ? <BoltSlashIcon /> : <CheckIcon />,
                  tooltip: item.enabled ? t('disable') : t('enable'),
                  onPress: async () => {
                    await parseAction(setOidcClientDisabled({ clientId: item.clientId, disabled: item.enabled }))
                    notify.success(t('msg_updated_target', { target: item.clientName || item.clientId }))
                    list.reload()
                  },
                },
                {
                  template: 'delete',
                  target: item.clientName || item.clientId,
                  action: async () => {
                    await parseAction(deleteOidcClient({ clientId: item.clientId }))
                    notify.success(t('msg_deleted_target', { target: item.clientName || item.clientId }))
                    list.reload()
                  },
                },
              ]}
            />
          </Table.Row>
        )}
      </MultiTable>
      {list.total > 0 && <NoticePanel className='text-xs'>{t('msg_dynamic_oidc_clients')}</NoticePanel>}
    </FlexCol>
  )
}
