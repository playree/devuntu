/**
 * Web プッシュへの配信の単体テスト
 *
 * 送信(`webpush-server.ts`)は差し替え、複数端末ぶんの結果を 1 つへ落とす規則を検証する。
 * 鍵の不正が端末ごとに起きる場合(鍵の差し替え後)とチャネル全体の構成障害を分けるのが要点。
 */

import type { NotifyContent } from '@/lib/notify/notify-content'
import { deliverWebPush } from '@/lib/notify/notify-webpush'
import type { StoredSubscription } from '@/lib/webpush/webpush-server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/webpush/webpush-server', () => ({
  findWebPushSubscriptions: vi.fn(async () => []),
  sendWebPush: vi.fn(async () => 'ok'),
  deleteWebPushSubscription: vi.fn(async () => undefined),
}))

const { findWebPushSubscriptions, sendWebPush, deleteWebPushSubscription } =
  await import('@/lib/webpush/webpush-server')
const findSubscriptions = vi.mocked(findWebPushSubscriptions)
const send = vi.mocked(sendWebPush)
const deleteSubscription = vi.mocked(deleteWebPushSubscription)

const content: NotifyContent = {
  subject: '[ABC-1] チケット1',
  body: 'メンションされました',
  url: 'https://devuntu.example.com/t/ABC-1',
}

const subscription = (id: string): StoredSubscription => ({
  id,
  endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
  p256dh: 'p256dh',
  auth: 'auth',
})

/** 端末を登録し、`sendWebPush()` の結果を登録順に返す */
const setupDevices = (...outcomes: Awaited<ReturnType<typeof sendWebPush>>[]) => {
  findSubscriptions.mockResolvedValue(outcomes.map((_, index) => subscription(`sub-${index + 1}`)))
  outcomes.forEach((outcome) => send.mockResolvedValueOnce(outcome))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('deliverWebPush: 端末ごとの結果を 1 つへ落とす', () => {
  it('端末が 1 台も無ければ送る先が無いので諦める', async () => {
    findSubscriptions.mockResolvedValue([])
    expect(await deliverWebPush({ userId: 'user-1', content })).toBe('unlinked')
    expect(send).not.toHaveBeenCalled()
  })

  it('1 台でも送れたら ok(再送すると届いた端末に二重で出てしまう)', async () => {
    setupDevices('retryable', 'ok')
    expect(await deliverWebPush({ userId: 'user-1', content })).toBe('ok')
  })

  it('全滅したら最初の失敗を返して再試行に回す', async () => {
    setupDevices('rate_limited', 'retryable')
    expect(await deliverWebPush({ userId: 'user-1', content })).toBe('rate_limited')
  })

  it('失効(unlinked)は端末だけの問題なので、配信の結果としては採らない', async () => {
    setupDevices('unlinked', 'retryable')
    expect(await deliverWebPush({ userId: 'user-1', content })).toBe('retryable')
  })

  it('全端末が失効なら送る先が無くなったのと同じ', async () => {
    setupDevices('unlinked', 'unlinked')
    expect(await deliverWebPush({ userId: 'user-1', content })).toBe('unlinked')
  })
})

describe('deliverWebPush: 鍵の不正(401 / 403)の切り分け', () => {
  it('全端末が鍵の不正なら VAPID の構成障害として打ち切りを伝える', async () => {
    setupDevices('revoked', 'revoked')
    expect(await deliverWebPush({ userId: 'user-1', content })).toBe('revoked')
    expect(deleteSubscription, '構成障害では購読を消さない').not.toHaveBeenCalled()
  })

  it('古い鍵の端末が先に来ても、後続の有効な端末へは送り切る', async () => {
    setupDevices('revoked', 'ok')
    expect(await deliverWebPush({ userId: 'user-1', content })).toBe('ok')
    expect(send, '打ち切らず全端末へ送る').toHaveBeenCalledTimes(2)
  })

  it('一部だけ鍵が不正な場合はその購読を消す(失効にならないので他では掃除されない)', async () => {
    setupDevices('revoked', 'ok')
    await deliverWebPush({ userId: 'user-1', content })
    expect(deleteSubscription).toHaveBeenCalledExactlyOnceWith('sub-1')
  })

  it('鍵の不正が一部で他も送れない場合は、打ち切らず再試行に回す', async () => {
    setupDevices('revoked', 'retryable')
    expect(await deliverWebPush({ userId: 'user-1', content })).toBe('retryable')
    expect(deleteSubscription).toHaveBeenCalledExactlyOnceWith('sub-1')
  })
})
