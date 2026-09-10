'use client'

import { MultiButton } from '@/components/general/button'
import { CheckBoxCtrl } from '@/components/general/checkbox'
import { FlexCol, FlexRow } from '@/components/general/flex'
import { NoticePanel } from '@/components/general/panel'
import { CheckIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { DM_NOTIFY_EVENTS, DmNotifyEvent, NOTIFY_EMAIL_WINDOW_MS } from '@/lib/notify/notify'
import { NotifySetting } from '@/lib/notify/notify-setting'
import { UpdateNotifySettings } from '@/lib/schema/schema'
import { useLocale } from '@/locale/client'
import { Tooltip } from '@heroui/react'
import { ComponentProps, FC } from 'react'
import { Control, useForm } from 'react-hook-form'
import { getNotifySettings, updateNotifySettings } from './server'

type FormValues = Record<DmNotifyEvent, NotifySetting>

/**
 * チャネル1つ分のチェックボックス。
 * 利用できないチャネルは隠さずに `isDisabled` で出し、`tooltip` でその理由を伝える。
 */
const ChannelCheckBox: FC<
  Omit<ComponentProps<typeof CheckBoxCtrl<FormValues>>, 'control' | 'className'> & {
    control: Control<FormValues>
    /** 指定すると理由として表示する(未指定なら Tooltip を付けない) */
    tooltip?: string
  }
> = ({ tooltip, ...props }) => {
  const checkbox = <CheckBoxCtrl className='shrink-0' {...props} />
  return tooltip ? (
    <Tooltip delay={300}>
      {/* isDisabled な Checkbox はホバー系のイベントを自ら拾わなくなるため、Trigger 側でホバーを検知させる */}
      <Tooltip.Trigger className='block'>{checkbox}</Tooltip.Trigger>
      <Tooltip.Content showArrow>{tooltip}</Tooltip.Content>
    </Tooltip>
  ) : (
    checkbox
  )
}

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
      <FlexCol className='gap-4'>
        <NoticePanel className='text-xs'>
          {t('msg_notify_email_digest', { minutes: NOTIFY_EMAIL_WINDOW_MS / 60_000 })}
        </NoticePanel>
        {DM_NOTIFY_EVENTS.map((event) => (
          <FlexCol key={event} className='gap-2'>
            <div className='text-foreground text-sm'>{t(`notify_event_${event}`)}</div>
            {/* チャネルが増えるとスマホ幅では収まらないので、縮めずに折り返す */}
            <FlexRow className='flex-wrap items-center gap-x-6 gap-y-2 px-2'>
              <ChannelCheckBox
                control={control}
                name={`${event}.email`}
                id={`notify_${event}_email`}
                label={t('notify_channel_email')}
              />
              <ChannelCheckBox
                control={control}
                name={`${event}.slack`}
                id={`notify_${event}_slack`}
                label={t('notify_channel_slack')}
                isDisabled={!slackAvailable}
                tooltip={slackAvailable ? undefined : t('msg_notify_slack_unavailable')}
              />
              <ChannelCheckBox
                control={control}
                name={`${event}.webpush`}
                id={`notify_${event}_webpush`}
                label={t('notify_channel_webpush')}
                isDisabled={!hasWebPushDevice}
                tooltip={hasWebPushDevice ? undefined : t('msg_webpush_no_device')}
              />
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
 * 全チャネルを常に表示する。今は届かないチャネルも、隠すと機能の存在自体が伝わらないため、
 * 操作だけを止めて理由を Tooltip で示す。
 */
export const NotifySettings: FC<{ slackAvailable: boolean; hasWebPushDevice: boolean }> = ({
  slackAvailable,
  // 端末を1つも登録していない間は Web プッシュを選んでも届かない
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
