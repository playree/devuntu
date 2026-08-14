'use client'

import { FlexCol, FlexRow } from '@/components/general/flex'
import { SwitchField } from '@/components/general/switch'
import { notify } from '@/components/notify'
import { parseAction, useActionData } from '@/lib/action-client'
import { NOTIFY_EVENTS } from '@/lib/notify'
import { useLocale } from '@/locale/client'
import { FC } from 'react'
import { getNotifySettings, updateNotifySetting } from './server'

/**
 * イベント種別ごとに通知チャネルの ON/OFF を切り替える。
 * 項目数が少ないのでフォームにはせず、切り替え即保存にする。
 */
export const NotifySettings: FC<{ slackAvailable: boolean }> = ({ slackAvailable }) => {
  const { t } = useLocale()
  const { data: settings, refresh } = useActionData(getNotifySettings)

  if (!settings) {
    return null
  }

  return (
    <FlexCol className='gap-4 px-1'>
      {NOTIFY_EVENTS.map((event) => {
        const setting = settings[event]
        const save = async (next: typeof setting) => {
          await parseAction(updateNotifySetting({ event, ...next }))
          notify.success(t('msg_saved'))
          refresh()
        }

        return (
          <FlexCol key={event} className='gap-2'>
            <div className='text-sm font-bold'>{t('notify_event_mention')}</div>
            <FlexRow className='gap-6'>
              <SwitchField
                id={`notify_${event}_email`}
                label={t('notify_channel_email')}
                isSelected={setting.email}
                onChange={(email) => save({ ...setting, email })}
              />
              {slackAvailable && (
                <SwitchField
                  id={`notify_${event}_slack`}
                  label={t('notify_channel_slack')}
                  isSelected={setting.slack}
                  onChange={(slack) => save({ ...setting, slack })}
                />
              )}
            </FlexRow>
          </FlexCol>
        )
      })}
    </FlexCol>
  )
}
