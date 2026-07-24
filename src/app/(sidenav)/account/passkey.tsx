'use client'

import { ActionCell } from '@/components/action-cell'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { useConfirmModal, useModalState } from '@/components/general/modal'
import { usePagingList } from '@/components/general/paging'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { PencilSquareIcon, PlusIcon } from '@/components/icon'
import { notify } from '@/components/notify'

import { authClient } from '@/lib/auth-client'
import { authConfig } from '@/lib/auth-config'
import { makePath } from '@/lib/client-utils'
import { dayformat } from '@/lib/day'
import { UpdatePasskey } from '@/lib/schema'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { getAuthenticatorName } from '@better-auth/passkey'
import { Table } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC } from 'react'
import { UpdatePasskeyModal } from './modals'

export const MyPasskey: FC = () => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const router = useRouter()
  const { confirmModal } = useConfirmModal()
  const { data: session } = authClient.useSession()
  const updateModalState = useModalState<UpdatePasskey>()

  const list = usePagingList({
    load: async () => {
      const res = await authClient.passkey.listUserPasskeys()
      if (res.data) {
        console.debug(res.data)
        return res.data.map(({ id, name, aaguid, createdAt }) => ({
          id,
          name: name ?? '',
          authenticator: getAuthenticatorName(aaguid) || 'Passkey',
          createdAt,
        }))
      }
      return []
    },
    sort: {
      init: { column: 'createdAt', direction: 'descending' },
    },
  })

  return (
    <FlexCol>
      <ContentHeader className='text-foreground'>
        <MultiButton
          icon={<PlusIcon />}
          onPress={async () => {
            const { data, error } = await authClient.passkey.addPasskey({
              authenticatorAttachment: 'platform',
            })
            console.debug('addPasskey', { data, error })
            if (data?.id) {
              notify.success(t('msg_added_passkey'), { description: t('msg_added_passkey_description') })
              list.reload()
            }
            if (error?.status === 403) {
              try {
                const ok = await confirmModal().confirm({
                  title: t('re_auth'),
                  text: t('msg_re_auth'),
                  autoClose: false,
                })
                if (ok) {
                  router.push(
                    makePath(authConfig.path.signIn, {
                      cb: window.location.href,
                      re: session?.user.email ?? '',
                    }).toString(),
                  )
                }
              } finally {
                confirmModal().close()
              }
            }
          }}
        >
          {t('register_passkey')}
        </MultiButton>
      </ContentHeader>

      <MultiTable
        ariaLabel='passkey list'
        pagingList={list}
        columns={[
          { id: 'name', name: t('name'), isRowHeader: true, allowsSorting: true, minWidth: 200, defaultWidth: '1fr' },
          { id: 'authenticator', name: t('authenticator'), allowsSorting: true, minWidth: 200, defaultWidth: '1fr' },
          { id: 'createdAt', name: t('created_at'), allowsSorting: true, minWidth: 110 },
          { id: 'action', name: t('action'), allowsSorting: false, defaultWidth: 100 },
        ]}
      >
        {(item) => (
          <Table.Row key={item.id} id={item.id}>
            <Table.Cell>{item.name || t('no_name')}</Table.Cell>
            <Table.Cell>
              <div className='flex items-center gap-2'>{item.authenticator}</div>
            </Table.Cell>
            <Table.Cell className='font-mono text-xs'>{dayformat(item.createdAt, 'tz-simple', tz)}</Table.Cell>
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
                {
                  template: 'delete',
                  target: item.name || item.authenticator,
                  action: async () => {
                    const { data } = await authClient.passkey.deletePasskey({ id: item.id })
                    if (data) {
                      notify.success(t('msg_deleted_target', { target: item.name || item.authenticator }))
                      list.reload()
                    }
                  },
                },
              ]}
            />
          </Table.Row>
        )}
      </MultiTable>

      {updateModalState.target && (
        <UpdatePasskeyModal
          state={updateModalState}
          reload={list.reload}
          key={updateModalState.key}
          target={updateModalState.target}
        />
      )}
    </FlexCol>
  )
}
