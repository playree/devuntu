'use client'

import { MultiButton } from '@/components/general/button'
import { GridBox } from '@/components/general/grid'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { SingleSelectField } from '@/components/general/select'
import { CheckIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { scSetBoardSlackChannel, SetBoardSlackChannel } from '@/lib/schema/schema'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC, useMemo } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { getBoardSlackChannels, GetBoardSlackChannelsReturnType, setBoardSlackChannel } from './server'

/**
 * 「通知しない」を表す選択肢のキー。
 *
 * 保存する値は空文字(Server Action 側で null へ正規化される)だが、`SingleSelectField` は
 * 空文字を未選択と見なしてトリガーに何も表示しないため、選択肢のキーには非空の値を使う。
 * チャンネルIDは `SLACK_CHANNEL_ID_PATTERN` により大文字始まりなので衝突しない。
 */
const NONE_KEY = 'none'

/** 保存する値(空文字 = 通知しない)を選択肢のキーへ寄せる */
const toKey = (slackChannelId: string) => slackChannelId || NONE_KEY

const ChannelForm: FC<{
  boardId: string
  current: string | null
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
      ...(current && !known[current] ? { [current]: current } : {}),
      ...known,
    }
  }, [channels, current, t])

  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting, errors },
  } = useForm<SetBoardSlackChannel>({
    resolver: zodResolver(scSetBoardSlackChannel),
    mode: 'onChange',
    defaultValues: { id: boardId, slackChannelId: current ?? '' },
  })

  return (
    <form
      onSubmit={handleSubmit(async (req) => {
        await parseAction(setBoardSlackChannel(req))
        notify.success(t('msg_saved'))
        // 再取得しても useForm の defaultValues は追従しないので、保存値で dirty を落としておく
        reset(req)
        // 変わったのは現在値だけでチャンネルの一覧は変わらないので、取り直すのはボード側
        refresh()
      })}
    >
      <GridBox isSmart>
        <div className='col-span-12'>
          <NoticePanel className='text-xs'>{t('msg_board_slack_notify_desc')}</NoticePanel>
        </div>
        <div className='col-span-12 md:col-span-6'>
          <Controller
            control={control}
            name='slackChannelId'
            render={({ field: { value, onChange, onBlur, ref } }) => (
              <SingleSelectField
                groupOptions={options}
                label={t('slack_notify_channel')}
                errorMessage={fet(errors.slackChannelId)}
                value={toKey(value)}
                onChange={(key) => {
                  if (key !== null) {
                    onChange(key === NONE_KEY ? '' : key)
                  }
                }}
                onBlur={onBlur}
                ref={ref}
              />
            )}
          />
        </div>
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
 * エージェントの実行結果を通知する Slack チャンネルの設定。
 *
 * 一覧には Bot が参加しているチャンネルだけが出る。出てこない = 招待されていない、と
 * 1 対 1 で対応するので、空のときは選択させずに招待を案内する。
 */
export const BoardSlackNotify: FC<{
  boardId: string
  slackChannelId: string | null
  /** 保存後にボード詳細(= 現在値)を取り直す。ローディング表示に戻さない refresh を渡すこと */
  refresh: () => void
}> = ({ boardId, slackChannelId, refresh }) => {
  const { t } = useLocale()
  const { data: channels, isLoading } = useActionData(() => getBoardSlackChannels({ id: boardId }))

  if (isLoading) {
    return <PanelSkeleton />
  }
  // 取得失敗(null)も空も、利用者から見れば「選べない」なので同じ案内に寄せる
  if (!channels || channels.length === 0) {
    return <NoticePanel className='text-xs'>{t('msg_slack_channel_empty')}</NoticePanel>
  }

  return <ChannelForm boardId={boardId} current={slackChannelId} channels={channels} refresh={refresh} />
}
