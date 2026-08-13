'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { useConfirmModal } from '@/components/general/modal'
import { SwitchField } from '@/components/general/switch'
import { ContentHeader } from '@/components/header'
import { BoltSlashIcon, SlackIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction, useActionData } from '@/lib/action-client'
import { authClient } from '@/lib/auth-client'
import { NOTIFY_EVENTS, SLACK_PROVIDER_ID } from '@/lib/slack'
import { useLocale } from '@/locale/client'
import { ButtonGroup } from '@heroui/react'
import { FC } from 'react'
import { disconnectSlack, getSlackStatus, GetSlackStatusReturnType, updateNotifySetting } from './server'

/** 通知種別ごとの ON/OFF。項目が1つなのでフォームにはせず、切り替え即保存にする */
const NotifySettings: FC<{ settings: NonNullable<GetSlackStatusReturnType>['settings']; onSaved: () => void }> = ({
  settings,
  onSaved,
}) => {
  const { t } = useLocale()

  return (
    <div className='px-1'>
      <div className='mb-2 text-sm font-bold'>{t('notify_settings')}</div>
      <FlexCol className='gap-2'>
        {NOTIFY_EVENTS.map((event) => (
          <SwitchField
            key={event}
            id={`notify_${event}`}
            label={t('notify_event_mention')}
            isSelected={settings[event].slack}
            onChange={async (slack) => {
              await parseAction(updateNotifySetting({ event, slack }))
              notify.success(t('msg_saved'))
              onSaved()
            }}
          />
        ))}
      </FlexCol>
    </div>
  )
}

export const SlackAccountLink: FC = () => {
  const { t } = useLocale()
  const { confirmModal } = useConfirmModal()
  const { data: status, reload, refresh } = useActionData(getSlackStatus)

  const link = async () => {
    await authClient.oauth2.link({ providerId: SLACK_PROVIDER_ID, callbackURL: '/account' })
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
            {t('account_connect')}
          </MultiButton>
        </ContentHeader>
      )}

      {!connected && <p className='px-1 text-sm text-neutral-500'>{t('msg_slack_email_must_match')}</p>}

      {connected && !!status && <NotifySettings settings={status.settings} onSaved={refresh} />}
    </FlexCol>
  )
}
