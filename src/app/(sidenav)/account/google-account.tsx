'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { useConfirmModal } from '@/components/general/modal'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { BoltSlashIcon, GoogleIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action-client'
import { authClient } from '@/lib/auth-client'
import { formatScopeLabel, GOOGLE_ACCOUNT_PROVIDER_ID } from '@/lib/google/google-calendar'
import { useLocale } from '@/locale/client'
import { ButtonGroup, Table } from '@heroui/react'
import { FC, useEffect, useState } from 'react'
import { disconnectGoogleAccount, getGoogleAccountStatus, GetGoogleAccountStatusReturnType } from './server'

export const GoogleAccountLink: FC = () => {
  const { t } = useLocale()
  const { confirmModal } = useConfirmModal()
  const [status, setStatus] = useState<GetGoogleAccountStatusReturnType>()

  const reload = () => {
    parseAction(getGoogleAccountStatus()).then((res) => setStatus(res))
  }

  useEffect(() => {
    reload()
  }, [])

  const link = async () => {
    // カレンダー連携専用プロバイダ(google-account)にリンク
    // (scopes/offline/consent はサーバーのプロバイダ設定側で固定)
    await authClient.linkSocial({
      provider: GOOGLE_ACCOUNT_PROVIDER_ID,
      callbackURL: '/account',
    })
  }

  const connected = status?.connected

  return (
    <FlexCol>
      {connected ? (
        <ContentHeader title={t('msg_google_account_connected')} className='text-foreground'>
          <MultiButton icon={<GoogleIcon />} onPress={link}>
            {t('account_relink')}
          </MultiButton>
          <MultiButton
            icon={<BoltSlashIcon />}
            onPress={async () => {
              const ok = await confirmModal().confirm({
                title: t('account_disconnect'),
                text: t('msg_google_account_connected'),
              })
              if (ok) {
                await parseAction(disconnectGoogleAccount())
                notify.success(t('account_disconnect'))
                reload()
              }
            }}
          >
            <ButtonGroup.Separator />
            {t('account_disconnect')}
          </MultiButton>
        </ContentHeader>
      ) : (
        <ContentHeader title={t('msg_google_account_not_connected')}>
          <MultiButton icon={<GoogleIcon />} onPress={link}>
            {t('account_connect_google')}
          </MultiButton>
        </ContentHeader>
      )}

      {connected && !!status?.scopes.length && (
        <div className='px-1'>
          <div className='mb-1 text-sm font-bold'>{t('granted_scopes')}</div>
          <MultiTable
            isSmart
            ariaLabel='granted scopes'
            columns={[{ id: 'scope', name: t('scope'), isRowHeader: true, defaultWidth: '1fr' }]}
            items={status.scopes.map((scope) => ({ id: scope, scope }))}
          >
            {(item) => (
              <Table.Row key={item.id} id={item.id}>
                <Table.Cell className='font-mono text-xs'>{formatScopeLabel(item.scope)}</Table.Cell>
              </Table.Row>
            )}
          </MultiTable>
        </div>
      )}
    </FlexCol>
  )
}
