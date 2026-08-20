'use client'

import { ActionCell } from '@/components/action-cell'
import { FlexCol } from '@/components/general/flex'
import { usePagingList } from '@/components/general/paging'
import { NoticePanel } from '@/components/general/panel'
import { MultiTable } from '@/components/general/table'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action-client'
import { dayformat } from '@/lib/day'
import { consentScopeLocaleItem } from '@/lib/oauth-consent'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { Table } from '@heroui/react'
import { FC } from 'react'
import { getMyOAuthConsents, revokeOAuthConsent } from './server'

export const MyOAuthConsents: FC = () => {
  const { t } = useLocale()
  const tz = useUserTimezone()

  const list = usePagingList({
    load: async () => {
      const data = await parseAction(getMyOAuthConsents())
      return data.map(({ id, clientId, clientName, scopes, updatedAt }) => ({
        id,
        clientName: clientName || clientId,
        scopes: scopes.map((scope) => {
          const item = consentScopeLocaleItem(scope)
          return item ? t(item) : scope
        }),
        updatedAt,
      }))
    },
    sort: {
      init: { column: 'updatedAt', direction: 'descending' },
    },
  })

  return (
    <FlexCol>
      <MultiTable
        ariaLabel='oauth consent list'
        pagingList={list}
        columns={[
          {
            id: 'clientName',
            name: t('client_name'),
            isRowHeader: true,
            allowsSorting: true,
            minWidth: 160,
            defaultWidth: '1fr',
          },
          { id: 'scopes', name: t('granted_scopes'), allowsSorting: false, minWidth: 200, defaultWidth: '1fr' },
          { id: 'updatedAt', name: t('granted_at'), allowsSorting: true, minWidth: 110 },
          { id: 'action', name: t('action'), allowsSorting: false, defaultWidth: 100 },
        ]}
      >
        {(item) => (
          <Table.Row key={item.id} id={item.id}>
            <Table.Cell>{item.clientName}</Table.Cell>
            <Table.Cell className='text-xs'>{item.scopes.join(' / ')}</Table.Cell>
            <Table.Cell className='font-mono text-xs'>{dayformat(item.updatedAt, 'tz-simple', tz)}</Table.Cell>
            <ActionCell
              items={[
                {
                  template: 'delete',
                  target: item.clientName,
                  action: async () => {
                    await parseAction(revokeOAuthConsent({ id: item.id }))
                    notify.success(t('msg_deleted_target', { target: item.clientName }))
                    list.reload()
                  },
                },
              ]}
            />
          </Table.Row>
        )}
      </MultiTable>
      {list.total > 0 && <NoticePanel className='text-xs'>{t('msg_confirm_revoke_consent')}</NoticePanel>}
    </FlexCol>
  )
}
