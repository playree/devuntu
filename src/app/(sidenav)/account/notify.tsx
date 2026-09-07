'use client'

import { CheckBoxField } from '@/components/general/checkbox'
import { FlexCol, FlexRow } from '@/components/general/flex'
import { notify } from '@/components/notify'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { DM_NOTIFY_EVENTS } from '@/lib/notify/notify'
import { useLocale } from '@/locale/client'
import { FC, useState } from 'react'
import { getNotifySettings, updateNotifySetting } from './server'

/**
 * イベント種別ごとに通知チャネルの ON/OFF を切り替える。
 * 項目数が少ないのでフォームにはせず、切り替え即保存にする。
 *
 * メールは常に表示する。Slack は連携を利用できるユーザーにだけ、Web プッシュは
 * 端末を登録済みのユーザーにだけ出す(届かないチェックボックスを見せない)。
 */
export const NotifySettings: FC<{ slackAvailable: boolean; hasWebPushDevice: boolean }> = ({
  slackAvailable,
  // 端末を1つも登録していないユーザーに Web プッシュのチェックボックスを見せても届かない
  hasWebPushDevice,
}) => {
  const { t } = useLocale()
  const { data: settings, refresh } = useActionData(getNotifySettings)
  // 保存中はチェックボックスを止める。連打すると後着の保存結果で表示が巻き戻る
  const [isSaving, setIsSaving] = useState(false)

  if (!settings) {
    return null
  }

  return (
    <FlexCol className='gap-4 px-1'>
      {DM_NOTIFY_EVENTS.map((event) => {
        const setting = settings[event]
        const save = async (next: typeof setting) => {
          setIsSaving(true)
          try {
            await parseAction(updateNotifySetting({ event, ...next }))
            notify.success(t('msg_saved'))
            await refresh()
          } finally {
            setIsSaving(false)
          }
        }

        return (
          <FlexCol key={event} className='gap-2'>
            <div className='text-foreground text-sm'>{t(`notify_event_${event}`)}</div>
            {/* チャネルが増えるとスマホ幅では収まらないので、縮めずに折り返す */}
            <FlexRow className='flex-wrap gap-x-6 gap-y-2 px-2'>
              <CheckBoxField
                className='shrink-0'
                id={`notify_${event}_email`}
                label={t('notify_channel_email')}
                isSelected={setting.email}
                isDisabled={isSaving}
                onChange={(email) => save({ ...setting, email })}
              />
              {slackAvailable && (
                <CheckBoxField
                  className='shrink-0'
                  id={`notify_${event}_slack`}
                  label={t('notify_channel_slack')}
                  isSelected={setting.slack}
                  isDisabled={isSaving}
                  onChange={(slack) => save({ ...setting, slack })}
                />
              )}
              {hasWebPushDevice && (
                <CheckBoxField
                  className='shrink-0'
                  id={`notify_${event}_webpush`}
                  label={t('notify_channel_webpush')}
                  isSelected={setting.webpush}
                  isDisabled={isSaving}
                  onChange={(webpush) => save({ ...setting, webpush })}
                />
              )}
            </FlexRow>
          </FlexCol>
        )
      })}
    </FlexCol>
  )
}
