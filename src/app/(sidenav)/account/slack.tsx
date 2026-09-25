'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { useConfirmModal } from '@/components/general/modal'
import { PanelSkeleton } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import { BoltSlashIcon, SlackIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { authClient } from '@/lib/auth/auth-client'
import { SLACK_PROVIDER_ID } from '@/lib/slack/slack'
import { useLocale } from '@/locale/client'
import { ButtonGroup } from '@heroui/react'
import { FC } from 'react'
import { disconnectSlack, getSlackStatus } from './server'

export const SlackAccountLink: FC = () => {
  const { t } = useLocale()
  const { confirmModal } = useConfirmModal()
  const { data: status, reload, isLoading } = useActionData(getSlackStatus)

  const link = async () => {
    await authClient.linkSocial({ provider: SLACK_PROVIDER_ID, callbackURL: '/account' })
  }

  // 取得前は未連携と区別できないため、連携済みでも一瞬「未連携」が出てしまう
  if (isLoading) {
    return <PanelSkeleton className='min-h-16' />
  }

  const connected = status?.connected

  return (
    <FlexCol>
      {connected ? (
        <ContentHeader title={t('msg_slack_connected')} className='text-foreground'>
          <MultiButton icon={<SlackIcon />} onPress={link}>
            {t('account_relink')}
          </MultiButton>
          <MultiButton
            icon={<BoltSlashIcon />}
            onPress={async () => {
              const ok = await confirmModal().confirm({
                title: t('account_disconnect'),
                text: t('msg_slack_connected'),
              })
              if (ok) {
                await parseAction(disconnectSlack())
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
        <ContentHeader title={t('msg_slack_not_connected')}>
          <MultiButton icon={<SlackIcon />} onPress={link}>
            {t('account_connect_slack')}
          </MultiButton>
        </ContentHeader>
      )}

      {!connected && <p className='text-muted px-1 text-sm'>{t('msg_slack_email_must_match')}</p>}
    </FlexCol>
  )
}
