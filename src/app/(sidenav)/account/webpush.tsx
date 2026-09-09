'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol, FlexRow } from '@/components/general/flex'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { BellIcon, BellSlashIcon, TrashIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { dayformat } from '@/lib/day'
import { resolveThisDeviceStatus } from '@/lib/webpush/webpush'
import {
  LocalSubscriptionPayload,
  LocalWebPushState,
  readLocalWebPushState,
  subscribeLocalPush,
  unsubscribeLocalPush,
} from '@/lib/webpush/webpush-client'
import { useLocale } from '@/locale/client'
import { Chip } from '@heroui/react'
import { FC, useCallback, useEffect, useState } from 'react'
import { deleteWebPushDevice, GetWebPushDevicesReturnType, getWebPushPublicKey, registerWebPushDevice } from './server'

/**
 * この端末で通知を受け取れるようにする。
 *
 * 権限の要求は**クリックを起点に呼ばないと拒否される**ので、必ずボタンのハンドラから呼ぶ。
 */
const subscribeThisDevice = async (publicKey: string) => {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return { ok: false as const, reason: 'blocked' as const }
  }

  let payload: LocalSubscriptionPayload
  try {
    payload = await subscribeLocalPush(publicKey)
  } catch (error) {
    // ここで握らないと画面には何も出ず、押しても無反応に見える
    console.error(error)
    return { ok: false as const, reason: 'failed' as const }
  }

  try {
    await parseAction(registerWebPushDevice(payload))
  } catch (error) {
    // ブラウザ側の購読だけ出来てサーバーに届いていない状態。握らないと成功したように見える
    console.error(error)
    return { ok: false as const, reason: 'failed' as const }
  }
  return { ok: true as const }
}

/**
 * ブラウザ側の状態を読む。
 *
 * VAPID 鍵が確定するまでは読まない(鍵が無いと購読の新旧を判定できない)。
 */
const useLocalWebPushState = (publicKey: string | null | undefined) => {
  const [localState, setLocalState] = useState<LocalWebPushState>()
  const reloadLocalState = useCallback(() => {
    if (!publicKey) {
      return Promise.resolve()
    }
    return readLocalWebPushState(publicKey).then((state) => {
      setLocalState(state)
    })
  }, [publicKey])

  useEffect(() => {
    void reloadLocalState()
  }, [reloadLocalState])

  return { localState, reloadLocalState }
}

/**
 * Web プッシュ通知の購読設定。
 *
 * 通知の ON/OFF はイベントごとの通知設定(`notify.tsx`)で行い、ここは
 * **「どの端末で受け取るか」**だけを扱う(端末ごとに登録が必要)。
 */
export const WebPushSettings: FC<{
  devices: GetWebPushDevicesReturnType
  isDevicesLoading: boolean
  refreshDevices: () => Promise<void>
}> = ({ devices, isDevicesLoading, refreshDevices }) => {
  const { t, lvt } = useLocale()
  const { data: publicKey, isLoading: isKeyLoading } = useActionData(getWebPushPublicKey)
  const { localState, reloadLocalState } = useLocalWebPushState(publicKey)
  const [isPending, setIsPending] = useState(false)

  if (isKeyLoading || isDevicesLoading) {
    return <PanelSkeleton />
  }
  // 未構成(VAPID 鍵が無い)の環境では登録させても送る手段が無いので、その旨だけ伝える
  if (!publicKey) {
    return <NoticePanel className='text-xs'>{t('msg_webpush_unavailable')}</NoticePanel>
  }
  /**
   * ブラウザ側の状態は `useEffect` で読むため初回レンダーでは未確定。
   * サーバーレンダリングと初回レンダーはどちらもスケルトンを返すのでハイドレーションはずれない。
   */
  if (!localState) {
    return <PanelSkeleton />
  }
  if (localState.support !== 'ok') {
    return (
      <NoticePanel className='text-xs'>
        {localState.support === 'ios-standalone' ? t('msg_webpush_ios_standalone') : t('msg_webpush_unsupported')}
      </NoticePanel>
    )
  }

  const status = resolveThisDeviceStatus(localState.subscription, devices)
  const thisDevice = devices?.find(({ id }) => id === status.deviceId)
  // 拒否されたままでは登録できないので、押させる前に案内する
  const isBlocked = localState.permission === 'denied'

  const enable = async () => {
    setIsPending(true)
    try {
      const result = await subscribeThisDevice(publicKey)
      if (!result.ok) {
        notify.error(t(result.reason === 'blocked' ? 'msg_webpush_blocked' : 'msg_webpush_failed'))
        // 拒否された場合は権限が変わっているので読み直す
        await reloadLocalState()
        return
      }
      notify.success(t('msg_saved'))
      /**
       * 端末一覧とブラウザ側の状態を両方待つ。
       * 片方だけだと突き合わせが1フレーム未登録側に転んでボタンがちらつく。
       */
      await Promise.all([refreshDevices(), reloadLocalState()])
    } finally {
      setIsPending(false)
    }
  }

  const remove = async (id: string, endpoint: string) => {
    setIsPending(true)
    try {
      await parseAction(deleteWebPushDevice({ id }))
      // 行を消してからブラウザ側を解除する(逆順だと送信先が死んでいる行が残りうる)
      await unsubscribeLocalPush(endpoint)
      notify.success(t('msg_deleted_target', { target: t('notify_webpush_devices') }))
      await Promise.all([refreshDevices(), reloadLocalState()])
    } catch (error) {
      // `parseAction` は `ClientError` を通知せずに throw するので、ここで拾わないと画面に何も出ない
      console.error(error)
      notify.error(t('msg_delete_failed_target', { target: t('notify_webpush_devices') }))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <FlexCol className='gap-4 px-1'>
      <NoticePanel className='text-xs'>{t('msg_webpush_desc')}</NoticePanel>

      {isBlocked && (
        <NoticePanel className='text-xs' status='warning'>
          {t('msg_webpush_blocked')}
        </NoticePanel>
      )}
      {thisDevice ? (
        <MultiButton
          className='self-start'
          size='sm'
          variant='danger-soft'
          icon={<BellSlashIcon />}
          isPending={isPending}
          onPress={() => remove(thisDevice.id, thisDevice.endpoint)}
        >
          {t('notify_webpush_disable')}
        </MultiButton>
      ) : (
        !isBlocked && (
          <MultiButton className='self-start' size='sm' icon={<BellIcon />} isPending={isPending} onPress={enable}>
            {t('notify_webpush_enable')}
          </MultiButton>
        )
      )}

      <FlexCol className='gap-2'>
        <div className='text-sm font-bold'>{t('notify_webpush_devices')}</div>
        {!devices || devices.length === 0 ? (
          <div className='text-default-500 text-sm'>{t('msg_webpush_no_device')}</div>
        ) : (
          devices.map(({ id, endpoint, label, createdAt, lastUsedAt }) => (
            // スマホでは端末名と操作が縦積みになるよう折り返す
            <FlexRow key={id} className='border-default-200 flex-wrap items-center gap-2 border-b pb-2'>
              <FlexCol className='min-w-0 grow gap-0.5'>
                <FlexRow className='min-w-0 items-center gap-1.5'>
                  <div className='truncate text-sm'>{label || t('notify_webpush')}</div>
                  {id === status.deviceId && (
                    <Chip className='shrink-0' color='success' variant='soft' size='sm'>
                      <Chip.Label>{t('notify_webpush_this_device')}</Chip.Label>
                    </Chip>
                  )}
                </FlexRow>
                <div className='text-default-500 text-xs'>
                  {lvt({ ja: '登録', en: 'Registered' })}: {dayformat(createdAt)}
                  {lastUsedAt ? ` / ${lvt({ ja: '最終送信', en: 'Last sent' })}: ${dayformat(lastUsedAt)}` : ''}
                </div>
              </FlexCol>
              <MultiButton
                size='sm'
                variant='danger-soft'
                icon={<TrashIcon />}
                isPending={isPending}
                onPress={() => remove(id, endpoint)}
              >
                {t('delete')}
              </MultiButton>
            </FlexRow>
          ))
        )}
      </FlexCol>
    </FlexCol>
  )
}
