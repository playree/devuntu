'use client'

import { MultiButton } from '@/components/general/button'
import { CheckboxGroupField } from '@/components/general/checkbox'
import { GridBox } from '@/components/general/grid'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { SingleSelectCtrl } from '@/components/general/select'
import { CheckIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import {
  SLACK_CHANNEL_NONE_KEY,
  SlackChannelsGuard,
  SlackChannelsReloadButton,
  SlackCurrentFailedNotice,
  useSlackChannelOptions,
  useSlackChannels,
} from '@/components/slack-channel'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { CHANNEL_NOTIFY_EVENTS } from '@/lib/notify/notify'
import { scSetBoardNotifySetting, SetBoardNotifySetting } from '@/lib/schema/schema-board'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { Controller, useForm } from 'react-hook-form'
import {
  getBoardNotify,
  GetBoardNotifyReturnType,
  getBoardSlackChannels,
  GetBoardSlackChannelsReturnType,
  setBoardNotify,
} from './server'

const NotifyForm: FC<{
  boardId: string
  current: NonNullable<GetBoardNotifyReturnType>
  channels: NonNullable<GetBoardSlackChannelsReturnType>
  refresh: () => void
  refreshChannels: () => void
  isChannelsRefreshing: boolean
}> = ({ boardId, current, channels, refresh, refreshChannels, isChannelsRefreshing }) => {
  const { t, fet } = useLocale()
  const options = useSlackChannelOptions(channels, current.slackChannelId)

  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting, errors },
  } = useForm<SetBoardNotifySetting>({
    resolver: zodResolver(scSetBoardNotifySetting),
    mode: 'onChange',
    defaultValues: { id: boardId, slackChannelId: current.slackChannelId ?? '', events: [...current.events] },
  })

  return (
    <form
      onSubmit={handleSubmit(async (req) => {
        await parseAction(setBoardNotify(req))
        notify.success(t('msg_saved'))
        /**
         * 再取得しても useForm の defaultValues は追従しないので、保存値で dirty を落としておく。
         * 通知先とイベントの片方が空の保存は「通知しない」なので、画面も両方空へ揃える
         * (保存した値のまま残すと、設定が消えているのに選択が残って見える)。
         */
        reset(req.slackChannelId && req.events.length > 0 ? req : { id: req.id, slackChannelId: '', events: [] })
        // 変わったのは現在値だけでチャンネルの一覧は変わらないので、取り直すのはこのセクション
        refresh()
      })}
    >
      <GridBox isSmart>
        <div className='col-span-12'>
          <NoticePanel className='text-xs'>{t('msg_board_slack_notify_desc')}</NoticePanel>
        </div>
        <div className='col-span-12 flex items-end gap-2 md:col-span-6'>
          <div className='grow'>
            <SingleSelectCtrl
              control={control}
              name='slackChannelId'
              groupOptions={options}
              label={t('slack_notify_channel')}
              errorMessage={fet(errors.slackChannelId)}
              emptyKey={SLACK_CHANNEL_NONE_KEY}
            />
          </div>
          <SlackChannelsReloadButton refreshChannels={refreshChannels} isChannelsRefreshing={isChannelsRefreshing} />
        </div>
        <Controller
          control={control}
          name='events'
          render={({ field: { value, onChange } }) => (
            <CheckboxGroupField
              className='col-span-12'
              label={t('slack_notify_events')}
              // 保存の並びを画面の並びに揃える(options の順で返るので、サーバー側で並べ直さずに済む)
              options={CHANNEL_NOTIFY_EVENTS.map((event) => ({
                value: event,
                label: t(`board_notify_event_${event}`),
              }))}
              value={value}
              onChange={onChange}
            />
          )}
        />
        <div className='col-span-12 flex items-center gap-2'>
          <MultiButton className='ml-auto' type='submit' size='sm' icon={<CheckIcon />} isPending={isSubmitting}>
            {t('save')}
          </MultiButton>
        </div>
      </GridBox>
    </form>
  )
}

/**
 * ボードのチャネル通知の設定(通知先チャンネル + 通知するイベント)。
 * チャンネルの一覧が取れない・空のときは `SlackChannelsGuard` が案内を出す
 */
export const BoardChannelNotify: FC<{ boardId: string }> = ({ boardId }) => {
  const { channels, isLoading, refreshChannels, isChannelsRefreshing } = useSlackChannels((force) =>
    getBoardSlackChannels({ id: boardId, force }),
  )
  const { data: current, isLoading: isCurrentLoading, refresh } = useActionData(() => getBoardNotify({ id: boardId }))

  if (isLoading || isCurrentLoading) {
    return <PanelSkeleton />
  }
  // 現在値が取れないと、保存済みの通知先を空欄に見せて上書きさせてしまうので、フォームを出さずに取り直させる
  if (!current) {
    return <SlackCurrentFailedNotice onReload={refresh} />
  }
  return (
    <SlackChannelsGuard
      channels={channels}
      currentId={current.slackChannelId}
      refreshChannels={refreshChannels}
      isChannelsRefreshing={isChannelsRefreshing}
    >
      {(channels) => (
        <NotifyForm
          boardId={boardId}
          current={current}
          channels={channels}
          refresh={refresh}
          refreshChannels={refreshChannels}
          isChannelsRefreshing={isChannelsRefreshing}
        />
      )}
    </SlackChannelsGuard>
  )
}
