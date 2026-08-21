'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { useConfirmModal } from '@/components/general/modal'
import { ContentHeader } from '@/components/header'
import { BoltSlashIcon, SlackIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction, useActionData } from '@/lib/action-client'
import { authClient } from '@/lib/auth-client'
import { SLACK_PROVIDER_ID } from '@/lib/slack/slack'
import { useLocale } from '@/locale/client'
import { ButtonGroup, Skeleton } from '@heroui/react'
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
    return <Skeleton className='min-h-16 w-full rounded-xl' />
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

      {!connected && <p className='px-1 text-sm text-neutral-500'>{t('msg_slack_email_must_match')}</p>}
    </FlexCol>
  )
}
