/**
 * Web プッシュの送信結果の分類の単体テスト
 *
 * 再試行の判断は `notify-queue.ts` の 1 箇所に集めているので、
 * 「どのステータスをどの結果へ落とすか」だけを固定すればよい。
 */

import { classifyWebPushStatus } from '@/lib/webpush/webpush-server'
import { describe, expect, it } from 'vitest'

describe('classifyWebPushStatus: HTTP ステータスの分類', () => {
  it('失効(404 / 410)はその端末だけ諦める', () => {
    // 購読が無効になった時点でプッシュサービスがこれを返す。行を消して宛先から外す
    expect(classifyWebPushStatus(404)).toBe('unlinked')
    expect(classifyWebPushStatus(410)).toBe('unlinked')
  })

  it('鍵の不正(401 / 403)は打ち切り相当(全端末で起きていれば構成障害)', () => {
    expect(classifyWebPushStatus(401)).toBe('revoked')
    expect(classifyWebPushStatus(403)).toBe('revoked')
  })

  it('429 はレート制限として再試行に回す', () => {
    expect(classifyWebPushStatus(429)).toBe('rate_limited')
  })

  it('5xx は一時障害として再試行に回す', () => {
    expect(classifyWebPushStatus(500)).toBe('retryable')
    expect(classifyWebPushStatus(502)).toBe('retryable')
    expect(classifyWebPushStatus(503)).toBe('retryable')
  })

  it('その他とステータス不明は failed に寄せる(仕様が増えても壊れない)', () => {
    expect(classifyWebPushStatus(400)).toBe('failed')
    expect(classifyWebPushStatus(413)).toBe('failed')
    expect(classifyWebPushStatus(undefined)).toBe('failed')
  })
})
