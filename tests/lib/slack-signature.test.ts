/**
 * Slack リクエスト署名検証の単体テスト
 *
 * `/api/slack/events` は未認証で叩けるため、ここが唯一の門番になる。
 */

import { MAX_CLOCK_SKEW_SEC, verifySlackSignature } from '@/lib/slack-signature'
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'

const SECRET = 'test-signing-secret'
const NOW_MS = 1_760_000_000_000
const TIMESTAMP = String(Math.floor(NOW_MS / 1000))
const BODY = '{"type":"event_callback"}'

/** Slack と同じ手順で署名を作る(検証側の実装とは独立に組み立てる) */
const sign = (timestamp: string, body: string, secret = SECRET) =>
  `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`

const verify = (override: Partial<Parameters<typeof verifySlackSignature>[0]> = {}) =>
  verifySlackSignature({
    signingSecret: SECRET,
    timestamp: TIMESTAMP,
    signature: sign(TIMESTAMP, BODY),
    rawBody: BODY,
    nowMs: NOW_MS,
    ...override,
  })

describe('verifySlackSignature', () => {
  it('正しい署名を受け入れる', () => {
    expect(verify()).toBe(true)
  })

  it('ボディが改ざんされていれば拒否する', () => {
    expect(verify({ rawBody: '{"type":"url_verification"}' })).toBe(false)
  })

  it('別のシークレットで作られた署名を拒否する', () => {
    expect(verify({ signature: sign(TIMESTAMP, BODY, 'other-secret') })).toBe(false)
  })

  it('タイムスタンプだけ差し替えた署名を拒否する', () => {
    // 署名は timestamp も含めて計算されるので、ヘッダだけ新しくしても通らない
    const older = String(Number(TIMESTAMP) - 10)
    expect(verify({ timestamp: older })).toBe(false)
  })

  it('許容範囲を超えて古いリクエストを拒否する(リプレイ対策)', () => {
    const old = String(Number(TIMESTAMP) - MAX_CLOCK_SKEW_SEC - 1)
    expect(verify({ timestamp: old, signature: sign(old, BODY) })).toBe(false)
  })

  it('許容範囲を超えて未来のリクエストを拒否する', () => {
    const future = String(Number(TIMESTAMP) + MAX_CLOCK_SKEW_SEC + 1)
    expect(verify({ timestamp: future, signature: sign(future, BODY) })).toBe(false)
  })

  it('許容範囲内の時計ずれは受け入れる', () => {
    const skewed = String(Number(TIMESTAMP) - MAX_CLOCK_SKEW_SEC + 1)
    expect(verify({ timestamp: skewed, signature: sign(skewed, BODY) })).toBe(true)
  })

  it('署名ヘッダが無ければ拒否する', () => {
    expect(verify({ signature: null }), '署名なし').toBe(false)
    expect(verify({ timestamp: null }), 'タイムスタンプなし').toBe(false)
  })

  it('シークレット未設定では拒否する', () => {
    expect(verify({ signingSecret: '' })).toBe(false)
  })

  it('数値でないタイムスタンプを拒否する', () => {
    // Number('') は 0 になるため、空文字が「エポック 0」として扱われないことも確かめる
    expect(verify({ timestamp: 'abc' }), '文字列').toBe(false)
    expect(verify({ timestamp: '' }), '空文字').toBe(false)
  })

  it('長さの違う署名でも例外にせず false を返す', () => {
    // timingSafeEqual は長さ違いで throw するので、手前で弾けていること
    expect(() => verify({ signature: 'v0=short' })).not.toThrow()
    expect(verify({ signature: 'v0=short' })).toBe(false)
  })
})
