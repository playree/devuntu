'use client'

import { MultiButton } from '@/components/general/button'
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
import { scSetWikiAnnounceChannel, type SetWikiAnnounceChannel } from '@/lib/schema/schema-wiki'
import type { SlackChannel } from '@/lib/slack/slack-server'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { type WikiSpaceContextValue } from '../space-context'
import { getWikiAnnounceChannel, getWikiSlackChannels, setWikiAnnounceChannel } from './server'

type Space = WikiSpaceContextValue['space']

const ChannelForm: FC<{
  space: Space
  currentId: string | null
  channels: SlackChannel[]
  refresh: () => void
  refreshChannels: () => void
  isChannelsRefreshing: boolean
}> = ({ space, currentId, channels, refresh, refreshChannels, isChannelsRefreshing }) => {
  const { t, fet } = useLocale()
  const options = useSlackChannelOptions(channels, currentId)

  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting, isDirty, errors },
  } = useForm<SetWikiAnnounceChannel>({
    resolver: zodResolver(scSetWikiAnnounceChannel),
    mode: 'onChange',
    defaultValues: { id: space.id, slackChannelId: currentId ?? '' },
  })

  return (
    <form
      onSubmit={handleSubmit(async (req) => {
        await parseAction(setWikiAnnounceChannel(req))
        notify.success(t('msg_saved'))
        // 再取得しても useForm の defaultValues は追従しないので、保存値で dirty を落としておく
        reset(req)
        refresh()
      })}
    >
      <GridBox isSmart>
        <div className='col-span-12'>
          <NoticePanel className='text-xs'>{t('msg_wiki_announce_channel_desc')}</NoticePanel>
        </div>
        {space.visibility === 'restricted' && (
          <div className='col-span-12'>
            <NoticePanel className='text-xs' status='warning'>
              {t('msg_wiki_announce_channel_restricted')}
            </NoticePanel>
          </div>
        )}
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
        <div className='col-span-12 flex items-center gap-2'>
          <MultiButton
            className='ml-auto'
            type='submit'
            size='sm'
            icon={<CheckIcon />}
            isPending={isSubmitting}
            isDisabled={!isDirty}
          >
            {t('save')}
          </MultiButton>
        </div>
      </GridBox>
    </form>
  )
}

/** アナウンス用スペースの通知先 Slack チャンネル(owner または管理者) */
export const WikiSpaceSlackNotify: FC<{ space: Space }> = ({ space }) => {
  const { channels, isLoading, refreshChannels, isChannelsRefreshing } = useSlackChannels((force) =>
    getWikiSlackChannels({ id: space.id, force }),
  )
  const {
    data: current,
    isLoading: isCurrentLoading,
    refresh,
  } = useActionData(() => getWikiAnnounceChannel({ id: space.id }))

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
        <ChannelForm
          space={space}
          currentId={current.slackChannelId}
          channels={channels}
          refresh={refresh}
          refreshChannels={refreshChannels}
          isChannelsRefreshing={isChannelsRefreshing}
        />
      )}
    </SlackChannelsGuard>
  )
}
