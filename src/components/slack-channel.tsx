'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { NoticePanel } from '@/components/general/panel'
import { ArrowPathIcon } from '@/components/icon'
import type { ActionResult } from '@/lib/action/action-client'
import { useActionData } from '@/lib/action/action-client'
import type { SlackChannel } from '@/lib/slack/slack-server'
import { useLocale } from '@/locale/client'
import { ComponentProps, FC, ReactNode, useMemo, useRef, useState } from 'react'

/**
 * 「通知しない」を表す選択肢のキー。
 *
 * 保存する値は空文字(Server Action 側で null へ正規化される)だが、`SingleSelectField` は
 * 空文字を未選択と見なしてトリガーに何も表示しないため、選択肢のキーには非空の値を使う。
 * チャンネルIDは `SLACK_CHANNEL_ID_PATTERN` により大文字始まりなので衝突しない。
 */
export const SLACK_CHANNEL_NONE_KEY = 'none'

/**
 * 通知先チャンネルの選択肢。「通知しない」を先頭に置く。
 * 設定済みのチャンネルが一覧から消えている(Bot が外された)場合も選択肢に残して、現在値が空欄に見えないようにする
 */
export const useSlackChannelOptions = (channels: readonly SlackChannel[], currentId: string | null) => {
  const { t } = useLocale()
  return useMemo(() => {
    // 公開は `#`、プライベートは鍵。Slack 本体の見え方に合わせて種別を判別できるようにする
    const known = Object.fromEntries(
      channels.map(({ id, name, isPrivate }) => [id, `${isPrivate ? '🔒' : '#'}${name}`]),
    )
    return {
      [SLACK_CHANNEL_NONE_KEY]: t('slack_notify_channel_none'),
      ...(currentId && !known[currentId] ? { [currentId]: currentId } : {}),
      ...known,
    }
  }, [channels, currentId, t])
}

/**
 * 選べる Slack チャンネルの一覧。`refreshChannels` はキャッシュを捨てて Slack から取り直す。
 * reload だとローディング表示へ切り替わってフォームが作り直され、未保存の選択が消えるので refresh を使う
 */
export const useSlackChannels = (load: (force: boolean) => Promise<ActionResult<SlackChannel[] | null>>) => {
  const [isChannelsRefreshing, setChannelsRefreshing] = useState(false)
  // useActionData は毎レンダーのインライン関数を ref 経由で常に最新を呼ぶので、force は ref で渡せる
  const forceRef = useRef(false)
  const { data, isLoading, refresh } = useActionData(() => {
    const force = forceRef.current
    // マウント時や後続の再取得までキャッシュを捨て続けないよう、1 回で戻す
    forceRef.current = false
    return load(force)
  })
  const refreshChannels = async () => {
    forceRef.current = true
    setChannelsRefreshing(true)
    try {
      await refresh()
    } finally {
      setChannelsRefreshing(false)
    }
  }
  return { channels: data, isLoading, refreshChannels, isChannelsRefreshing }
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
 * 一覧が取れないとき・空のときの案内。どちらでもなければ `children` に一覧を渡す。
 *
 * 一覧には Bot が参加しているチャンネルだけが出る。出てこない = 招待されていない、と
 * 1 対 1 で対応するので、空のときは選択させずに招待を案内する。
 * 取得に失敗したときは招待しても解決しないので、案内を分ける。
 * どちらの場合も、通知先が設定済み(`currentId`)なら案内の下にフォームを出して解除だけはできるようにする
 * (Bot がチャンネルから外されると一覧が空になり、そのままでは「通知しない」を選べなくなるため)
 */
export const SlackChannelsGuard: FC<{
  channels: SlackChannel[] | null | undefined
  currentId: string | null | undefined
  refreshChannels: () => void
  isChannelsRefreshing: boolean
  children: (channels: SlackChannel[]) => ReactNode
}> = ({ channels, currentId, refreshChannels, isChannelsRefreshing, children }) => {
  const { t } = useLocale()
  if (channels && channels.length > 0) {
    return children(channels)
  }
  return (
    <FlexCol>
      <ChannelsNotice
        message={channels ? t('msg_slack_channel_empty') : t('msg_slack_channel_failed')}
        status={channels ? undefined : 'warning'}
        onReload={refreshChannels}
        isPending={isChannelsRefreshing}
      />
      {currentId && children([])}
    </FlexCol>
  )
}

/**
 * 通知先の現在値を取得できなかったときの案内 + リロード
 */
export const SlackCurrentFailedNotice: FC<{ onReload: () => void }> = ({ onReload }) => {
  const { t } = useLocale()
  return (
    <ChannelsNotice
      message={t('msg_slack_notify_load_failed')}
      status='warning'
      onReload={onReload}
      isPending={false}
    />
  )
}

/** Bot を招待した直後は一覧のキャッシュに乗っていないので、その場で取り直せるようにするボタン */
export const SlackChannelsReloadButton: FC<{ refreshChannels: () => void; isChannelsRefreshing: boolean }> = ({
  refreshChannels,
  isChannelsRefreshing,
}) => {
  const { t } = useLocale()
  return (
    <MultiButton
      isIconOnly
      size='sm'
      variant='outline'
      tooltip={t('reload')}
      coolTime={5}
      isPending={isChannelsRefreshing}
      icon={<ArrowPathIcon width={16} />}
      onPress={refreshChannels}
    />
  )
}
