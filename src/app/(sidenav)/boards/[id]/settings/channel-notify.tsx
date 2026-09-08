'use client'

import { MultiButton } from '@/components/general/button'
import { CheckBoxField } from '@/components/general/checkbox'
import { FlexCol } from '@/components/general/flex'
import { GridBox } from '@/components/general/grid'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { SingleSelectCtrl } from '@/components/general/select'
import { useSmart } from '@/components/general/smart'
import { ArrowPathIcon, CheckIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { CHANNEL_NOTIFY_EVENTS } from '@/lib/notify/notify'
import { scSetBoardNotifySetting, SetBoardNotifySetting } from '@/lib/schema/schema'
import { useLocale } from '@/locale/client'
import { CheckboxGroup, Label } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { ComponentProps, FC, useMemo, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import {
  getBoardNotify,
  GetBoardNotifyReturnType,
  getBoardSlackChannels,
  GetBoardSlackChannelsReturnType,
  setBoardNotify,
} from './server'

/**
 * 「通知しない」を表す選択肢のキー。
 *
 * 保存する値は空文字(Server Action 側で null へ正規化される)だが、`SingleSelectField` は
 * 空文字を未選択と見なしてトリガーに何も表示しないため、選択肢のキーには非空の値を使う。
 * チャンネルIDは `SLACK_CHANNEL_ID_PATTERN` により大文字始まりなので衝突しない。
 */
const NONE_KEY = 'none'

/**
 * 通知するイベントの選択。
 * ラベルの体裁を他のフィールドへ揃えるため、`GridBox` 配下で isSmart を解決したいので部品を分ける。
 */
const EventsField: FC<{
  value: SetBoardNotifySetting['events']
  onChange: (events: SetBoardNotifySetting['events']) => void
}> = ({ value, onChange }) => {
  const { t } = useLocale()
  const { isCompact } = useSmart()

  return (
    <CheckboxGroup // checkbox-group の既定は子に mt-4 が入るため、gap で詰められるよう打ち消す
      className='col-span-12 gap-2 **:data-[slot=checkbox]:mt-0'
      value={value}
      // 保存の並びを画面の並びに揃える(サーバー側で並べ直さずに済む)
      onChange={(keys) => onChange(CHANNEL_NOTIFY_EVENTS.filter((event) => keys.includes(event)))}
    >
      <Label className={isCompact ? 'text-xs font-light' : ''}>{t('slack_notify_events')}</Label>
      {CHANNEL_NOTIFY_EVENTS.map((event) => (
        <CheckBoxField key={event} id={`board_notify_${event}`} value={event} label={t(`notify_event_${event}`)} />
      ))}
    </CheckboxGroup>
  )
}

const NotifyForm: FC<{
  boardId: string
  current: NonNullable<GetBoardNotifyReturnType>
  channels: NonNullable<GetBoardSlackChannelsReturnType>
  refresh: () => void
  refreshChannels: () => void
  isChannelsRefreshing: boolean
}> = ({ boardId, current, channels, refresh, refreshChannels, isChannelsRefreshing }) => {
  const { t, fet } = useLocale()

  // 「通知しない」を先頭に置く。設定済みのチャンネルが一覧から消えている(Bot が外された)場合も
  // 選択肢に残して、現在値が空欄に見えないようにする
  const options = useMemo(() => {
    // 公開は `#`、プライベートは鍵。Slack 本体の見え方に合わせて種別を判別できるようにする
    const known = Object.fromEntries(
      channels.map(({ id, name, isPrivate }) => [id, `${isPrivate ? '🔒' : '#'}${name}`]),
    )
    return {
      [NONE_KEY]: t('slack_notify_channel_none'),
      ...(current.slackChannelId && !known[current.slackChannelId]
        ? { [current.slackChannelId]: current.slackChannelId }
        : {}),
      ...known,
    }
  }, [channels, current.slackChannelId, t])

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
              emptyKey={NONE_KEY}
            />
          </div>
          <MultiButton // Bot を招待した直後は一覧のキャッシュに乗っていないので、その場で取り直せるようにする
            isIconOnly
            size='sm'
            variant='outline'
            tooltip={t('reload')}
            coolTime={5}
            isPending={isChannelsRefreshing}
            onPress={refreshChannels}
          >
            <ArrowPathIcon width={16} />
          </MultiButton>
        </div>
        <Controller
          control={control}
          name='events'
          render={({ field: { value, onChange } }) => <EventsField value={value} onChange={onChange} />}
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
 * チャンネルを選べないときの案内 + リロード。
 * 招待したてのチャンネルも、取得に失敗した状態もここへ落ちるため、TTL を待たずに取り直せるようにする。
 */
const ChannelsNotice: FC<{
  message: string
  status?: ComponentProps<typeof NoticePanel>['status']
  onReload: () => void
  isPending: boolean
}> = ({ message, status, onReload, isPending }) => {
  const { t } = useLocale()

  return (
    <FlexCol>
      <NoticePanel className='text-xs' status={status}>
        {message}
      </NoticePanel>
      <div>
        <MultiButton
          size='sm'
          variant='outline'
          icon={<ArrowPathIcon width={16} />}
          coolTime={5}
          isPending={isPending}
          onPress={onReload}
        >
          {t('reload')}
        </MultiButton>
      </div>
    </FlexCol>
  )
}

/**
 * ボードのチャネル通知の設定(通知先チャンネル + 通知するイベント)。
 *
 * 一覧には Bot が参加しているチャンネルだけが出る。出てこない = 招待されていない、と
 * 1 対 1 で対応するので、空のときは選択させずに招待を案内する。
 * 取得に失敗したときは招待しても解決しないので、案内を分ける。
 */
export const BoardChannelNotify: FC<{ boardId: string }> = ({ boardId }) => {
  const { t } = useLocale()
  const [isChannelsRefreshing, setChannelsRefreshing] = useState(false)
  // useActionData は毎レンダーのインライン関数を ref 経由で常に最新を呼ぶので、force は ref で渡せる
  const forceRef = useRef(false)
  const {
    data: channels,
    isLoading,
    refresh: refreshChannelsData,
  } = useActionData(() => {
    const force = forceRef.current
    // マウント時や後続の再取得までキャッシュを捨て続けないよう、1 回で戻す
    forceRef.current = false
    return getBoardSlackChannels({ id: boardId, force })
  })
  const { data: current, isLoading: isCurrentLoading, refresh } = useActionData(() => getBoardNotify({ id: boardId }))

  /**
   * キャッシュを捨てて Slack から取り直す。
   * reload だとローディング表示へ切り替わってフォームが作り直され、未保存の選択が消えるので refresh を使う。
   */
  const refreshChannels = async () => {
    forceRef.current = true
    setChannelsRefreshing(true)
    try {
      await refreshChannelsData()
    } finally {
      setChannelsRefreshing(false)
    }
  }

  if (isLoading || isCurrentLoading) {
    return <PanelSkeleton />
  }
  // 取得失敗は Bot の招待では解決しないので、招待手順は空のときだけ出す
  if (!channels) {
    return (
      <ChannelsNotice
        message={t('msg_slack_channel_failed')}
        status='warning'
        onReload={refreshChannels}
        isPending={isChannelsRefreshing}
      />
    )
  }
  if (channels.length === 0) {
    return (
      <ChannelsNotice
        message={t('msg_slack_channel_empty')}
        onReload={refreshChannels}
        isPending={isChannelsRefreshing}
      />
    )
  }
  if (!current) {
    return null
  }

  return (
    <NotifyForm
      boardId={boardId}
      current={current}
      channels={channels}
      refresh={refresh}
      refreshChannels={refreshChannels}
      isChannelsRefreshing={isChannelsRefreshing}
    />
  )
}
