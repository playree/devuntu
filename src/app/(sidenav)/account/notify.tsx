'use client'

import { MultiButton } from '@/components/general/button'
import { CheckBoxCtrl } from '@/components/general/checkbox'
import { FlexCol, FlexRow } from '@/components/general/flex'
import { CheckIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { DM_NOTIFY_EVENTS, DmNotifyEvent } from '@/lib/notify/notify'
import { NotifySetting } from '@/lib/notify/notify-setting'
import { UpdateNotifySettings } from '@/lib/schema/schema'
import { useLocale } from '@/locale/client'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { getNotifySettings, updateNotifySettings } from './server'

type FormValues = Record<DmNotifyEvent, NotifySetting>

/**
 * 通知設定フォーム本体。
 * `settings` を defaultValues にそのまま渡せるよう、取得済みのデータが揃ってから
 * このコンポーネントごとマウントする(でないと undefined → boolean の切り替えで
 * チェックボックスが uncontrolled → controlled の警告を出す)。
 */
const NotifyForm: FC<{
  settings: FormValues
  slackAvailable: boolean
  hasWebPushDevice: boolean
  refresh: () => Promise<void>
}> = ({ settings, slackAvailable, hasWebPushDevice, refresh }) => {
  const { t } = useLocale()
  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<FormValues>({ defaultValues: settings })

  return (
    <form
      onSubmit={handleSubmit(async (values) => {
        const req: UpdateNotifySettings = {
          settings: DM_NOTIFY_EVENTS.map((event) => ({ event, ...values[event] })),
        }
        await parseAction(updateNotifySettings(req))
        notify.success(t('msg_saved'))
        reset(values)
        await refresh()
      })}
    >
      <FlexCol className='gap-4 px-1'>
        {DM_NOTIFY_EVENTS.map((event) => (
          <FlexCol key={event} className='gap-2'>
            <div className='text-foreground text-sm'>{t(`notify_event_${event}`)}</div>
            {/* チャネルが増えるとスマホ幅では収まらないので、縮めずに折り返す */}
            <FlexRow className='flex-wrap gap-x-6 gap-y-2 px-2'>
              <CheckBoxCtrl
                className='shrink-0'
                control={control}
                name={`${event}.email`}
                id={`notify_${event}_email`}
                label={t('notify_channel_email')}
              />
              {slackAvailable && (
                <CheckBoxCtrl
                  className='shrink-0'
                  control={control}
                  name={`${event}.slack`}
                  id={`notify_${event}_slack`}
                  label={t('notify_channel_slack')}
                />
              )}
              {hasWebPushDevice && (
                <CheckBoxCtrl
                  className='shrink-0'
                  control={control}
                  name={`${event}.webpush`}
                  id={`notify_${event}_webpush`}
                  label={t('notify_channel_webpush')}
                />
              )}
            </FlexRow>
          </FlexCol>
        ))}
        <div className='flex items-center gap-2 pt-2'>
          <MultiButton className='ml-auto' type='submit' size='sm' icon={<CheckIcon />} isPending={isSubmitting}>
            {t('save')}
          </MultiButton>
        </div>
      </FlexCol>
    </form>
  )
}

/**
 * イベント種別ごとに通知チャネルの ON/OFF を切り替える。
 * 保存ボタン押下でイベント分をまとめて保存する(切り替え単位での即時保存は行わない)。
 *
 * メールは常に表示する。Slack は連携を利用できるユーザーにだけ、Web プッシュは
 * 端末を登録済みのユーザーにだけ出す(届かないチェックボックスを見せない)。
 */
export const NotifySettings: FC<{ slackAvailable: boolean; hasWebPushDevice: boolean }> = ({
  slackAvailable,
  // 端末を1つも登録していないユーザーに Web プッシュのチェックボックスを見せても届かない
  hasWebPushDevice,
}) => {
  const { data: settings, refresh } = useActionData(getNotifySettings)

  if (!settings) {
    return null
  }

  return (
    <NotifyForm
      settings={settings}
      slackAvailable={slackAvailable}
      hasWebPushDevice={hasWebPushDevice}
      refresh={refresh}
    />
  )
}
