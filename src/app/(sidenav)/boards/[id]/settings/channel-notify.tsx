'use client'

import { MultiButton } from '@/components/general/button'
import { CheckBoxField } from '@/components/general/checkbox'
import { GridBox } from '@/components/general/grid'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { SingleSelectCtrl } from '@/components/general/select'
import { useSmart } from '@/components/general/smart'
import { CheckIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { CHANNEL_NOTIFY_EVENTS } from '@/lib/notify/notify'
import { scSetBoardNotifySetting, SetBoardNotifySetting } from '@/lib/schema/schema'
import { useLocale } from '@/locale/client'
import { CheckboxGroup, Label } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC, useMemo } from 'react'
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
}> = ({ boardId, current, channels, refresh }) => {
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
        // 再取得しても useForm の defaultValues は追従しないので、保存値で dirty を落としておく
        reset(req)
        // 変わったのは現在値だけでチャンネルの一覧は変わらないので、取り直すのはこのセクション
        refresh()
      })}
    >
      <GridBox isSmart>
        <div className='col-span-12'>
          <NoticePanel className='text-xs'>{t('msg_board_slack_notify_desc')}</NoticePanel>
        </div>
        <div className='col-span-12 md:col-span-6'>
          <SingleSelectCtrl
            control={control}
            name='slackChannelId'
            groupOptions={options}
            label={t('slack_notify_channel')}
            errorMessage={fet(errors.slackChannelId)}
            emptyKey={NONE_KEY}
          />
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
 * ボードのチャネル通知の設定(通知先チャンネル + 通知するイベント)。
 *
 * 一覧には Bot が参加しているチャンネルだけが出る。出てこない = 招待されていない、と
 * 1 対 1 で対応するので、空のときは選択させずに招待を案内する。
 */
export const BoardChannelNotify: FC<{ boardId: string }> = ({ boardId }) => {
  const { t } = useLocale()
  const { data: channels, isLoading } = useActionData(() => getBoardSlackChannels({ id: boardId }))
  const { data: current, isLoading: isCurrentLoading, refresh } = useActionData(() => getBoardNotify({ id: boardId }))

  if (isLoading || isCurrentLoading) {
    return <PanelSkeleton />
  }
  // 取得失敗(null)も空も、利用者から見れば「選べない」なので同じ案内に寄せる
  if (!channels || channels.length === 0) {
    return <NoticePanel className='text-xs'>{t('msg_slack_channel_empty')}</NoticePanel>
  }
  if (!current) {
    return null
  }

  return <NotifyForm boardId={boardId} current={current} channels={channels} refresh={refresh} />
}
