'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol, FlexRow } from '@/components/general/flex'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { BellIcon, TrashIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { dayformat } from '@/lib/day'
import {
  guessDeviceLabel,
  isSameApplicationServerKey,
  isWebPushSupported,
  SERVICE_WORKER_PATH,
  urlBase64ToUint8Array,
} from '@/lib/webpush/webpush'
import { useLocale } from '@/locale/client'
import { FC, useState } from 'react'
import { deleteWebPushDevice, GetWebPushDevicesReturnType, getWebPushPublicKey, registerWebPushDevice } from './server'

/** `PushSubscription` の鍵を報告に載せる形(base64url)へ直す */
const toBase64Url = (buffer: ArrayBuffer | null): string => {
  if (!buffer) {
    return ''
  }
  const binary = String.fromCharCode(...new Uint8Array(buffer))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** iOS / iPadOS か。ホーム画面に追加していないと Push API が使えないので案内を出し分ける */
const isIos = (userAgent: string) => /iPhone|iPad|iPod/.test(userAgent)

/** ホーム画面から起動しているか(standalone) */
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  // iOS Safari は display-mode を返さないことがあるので独自プロパティも見る
  ('standalone' in window.navigator && window.navigator.standalone === true)

type WebPushSupport = 'ok' | 'unsupported' | 'ios-standalone'

/**
 * この環境で Web プッシュを使えるか。
 *
 * iOS はホーム画面に追加すれば使えるので、非対応とは案内を分ける。
 */
const detectSupport = (): WebPushSupport => {
  if (isWebPushSupported()) {
    return 'ok'
  }
  return isIos(navigator.userAgent) && !isStandalone() ? 'ios-standalone' : 'unsupported'
}

/**
 * ブラウザ側の購読を作る。
 *
 * 鍵の不一致やプッシュサービスへ到達できない場合は例外になるが、利用者に打てる手が
 * 無いので理由は分けず `failed` にまとめる(詳細はコンソールに残す)。
 */
const createSubscription = async (publicKey: string) => {
  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_PATH)
  // 登録直後は activate 前で pushManager を触れないことがある
  await navigator.serviceWorker.ready

  const applicationServerKey = urlBase64ToUint8Array(publicKey)
  /**
   * 鍵を差し替えた後は古い購読が残っていると購読し直せないので、先に解除する。
   * 解除した購読はサーバー側にも残るため、エンドポイントを報告して消してもらう。
   */
  const current = await registration.pushManager.getSubscription()
  let replacedEndpoint: string | undefined
  if (current && !isSameApplicationServerKey(current.options.applicationServerKey, applicationServerKey)) {
    replacedEndpoint = current.endpoint
    await current.unsubscribe()
  }

  const subscription = await registration.pushManager.subscribe({
    // ブラウザの要件。受け取ったら必ず通知を出す(Service Worker 側で守る)
    userVisibleOnly: true,
    applicationServerKey,
  })
  return { subscription, replacedEndpoint }
}

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

  let created: Awaited<ReturnType<typeof createSubscription>>
  try {
    created = await createSubscription(publicKey)
  } catch (error) {
    // ここで握らないと画面には何も出ず、押しても無反応に見える
    console.error(error)
    return { ok: false as const, reason: 'failed' as const }
  }

  const { subscription, replacedEndpoint } = created
  try {
    await parseAction(
      registerWebPushDevice({
        endpoint: subscription.endpoint,
        p256dh: toBase64Url(subscription.getKey('p256dh')),
        auth: toBase64Url(subscription.getKey('auth')),
        label: guessDeviceLabel(navigator.userAgent) || undefined,
        replacedEndpoint,
      }),
    )
  } catch (error) {
    // ブラウザ側の購読だけ出来てサーバーに届いていない状態。握らないと成功したように見える
    console.error(error)
    return { ok: false as const, reason: 'failed' as const }
  }
  return { ok: true as const }
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
  const [isPending, setIsPending] = useState(false)

  if (isKeyLoading || isDevicesLoading) {
    return <PanelSkeleton />
  }
  // 未構成(VAPID 鍵が無い)の環境では登録させても送る手段が無いので、その旨だけ伝える
  if (!publicKey) {
    return <NoticePanel className='text-xs'>{t('msg_webpush_unavailable')}</NoticePanel>
  }

  /**
   * ここから先はデータ取得後なのでクライアントのみ。
   *
   * `useActionData` は `isLoading: true` で始まり、サーバーレンダリングと初回レンダーは
   * どちらもスケルトンを返すので、ブラウザ API を触ってもハイドレーションはずれない。
   */
  const support = detectSupport()
  if (support !== 'ok') {
    return (
      <NoticePanel className='text-xs'>
        {support === 'ios-standalone' ? t('msg_webpush_ios_standalone') : t('msg_webpush_unsupported')}
      </NoticePanel>
    )
  }

  const enable = async () => {
    setIsPending(true)
    try {
      const result = await subscribeThisDevice(publicKey)
      if (!result.ok) {
        notify.error(t(result.reason === 'blocked' ? 'msg_webpush_blocked' : 'msg_webpush_failed'))
        return
      }
      notify.success(t('msg_saved'))
      await refreshDevices()
    } finally {
      setIsPending(false)
    }
  }

  const remove = async (id: string) => {
    setIsPending(true)
    try {
      await parseAction(deleteWebPushDevice({ id }))
      notify.success(t('msg_deleted_target', { target: t('notify_webpush_devices') }))
      await refreshDevices()
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

      <MultiButton className='self-start' size='sm' icon={<BellIcon />} isPending={isPending} onPress={enable}>
        {t('notify_webpush_enable')}
      </MultiButton>

      <FlexCol className='gap-2'>
        <div className='text-sm font-bold'>{t('notify_webpush_devices')}</div>
        {!devices || devices.length === 0 ? (
          <div className='text-default-500 text-sm'>{t('msg_webpush_no_device')}</div>
        ) : (
          devices.map(({ id, label, createdAt, lastUsedAt }) => (
            // スマホでは端末名と操作が縦積みになるよう折り返す
            <FlexRow key={id} className='border-default-200 flex-wrap items-center gap-2 border-b pb-2'>
              <FlexCol className='min-w-0 grow gap-0.5'>
                <div className='truncate text-sm'>{label || t('notify_webpush')}</div>
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
                onPress={() => remove(id)}
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
