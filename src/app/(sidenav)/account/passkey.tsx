'use client'

import { ActionCell } from '@/components/action-cell'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { useModalState } from '@/components/general/modal'
import { usePagingList } from '@/components/general/paging'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { PencilSquareIcon, PlusIcon } from '@/components/icon'
import { notify } from '@/components/notify'

import { authClient } from '@/lib/auth/auth-client'
import { useReAuth } from '@/lib/auth/use-re-auth'
import { dayformat } from '@/lib/day'
import { UpdatePasskey } from '@/lib/schema/schema'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { getAuthenticatorName } from '@better-auth/passkey'
import { Table } from '@heroui/react'
import { FC } from 'react'
import { UpdatePasskeyModal } from './modals'

/**
 * 本人の中断と断定できるコード。ブラウザの NotAllowedError は `@simplewebauthn/browser` が
 * ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY に変換するが、キャンセル以外(時間切れ・拒否など)も含み
 * 原因を区別できないので、ここには含めず通知する
 */
const PASSKEY_CANCEL_CODES = ['ERROR_CEREMONY_ABORTED']

export const MyPasskey: FC = () => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const reAuth = useReAuth()
  const updateModalState = useModalState<UpdatePasskey>()

  const list = usePagingList({
    load: async () => {
      const res = await authClient.passkey.listUserPasskeys()
      if (res.error) {
        notify.warn(t('msg_passkey_failed'))
      }
      if (res.data) {
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
            if (data?.id) {
              notify.success(t('msg_added_passkey'), { description: t('msg_added_passkey_description') })
              list.reload()
              return
            }
            if (error?.status === 403) {
              await reAuth()
              return
            }
            // 認証器のダイアログを閉じた場合は本人の操作なので通知しない
            if (error && !('code' in error && PASSKEY_CANCEL_CODES.includes(error.code))) {
              notify.warn(t('msg_passkey_failed'))
            }
          }}
        >
          {t('register_passkey')}
        </MultiButton>
      </ContentHeader>

      <MultiTable
        isSmart
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
                    if (!data) {
                      notify.warn(t('msg_passkey_failed'))
                      return
                    }
                    notify.success(t('msg_deleted_target', { target: item.name || item.authenticator }))
                    list.reload()
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
