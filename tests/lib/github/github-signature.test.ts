/**
 * GitHub Webhook 署名検証の単体テスト
 *
 * `/api/github/webhook` は未認証で叩けるため、ここが唯一の門番になる。
 */

import { verifyGithubSignature } from '@/lib/github/github-signature'
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'

const SECRET = 'test-webhook-secret'
const BODY = '{"action":"opened"}'

/** GitHub と同じ手順で署名を作る(検証側の実装とは独立に組み立てる) */
const sign = (body: string, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

const verify = (override: Partial<Parameters<typeof verifyGithubSignature>[0]> = {}) =>
  verifyGithubSignature({ secret: SECRET, signature: sign(BODY), rawBody: BODY, ...override })

describe('verifyGithubSignature', () => {
  it('正しい署名を受け入れる', () => {
    expect(verify()).toBe(true)
  })

  it('ボディが改ざんされていれば拒否する', () => {
    expect(verify({ rawBody: '{"action":"closed"}' })).toBe(false)
  })

  it('別のシークレットで作られた署名を拒否する', () => {
    expect(verify({ signature: sign(BODY, 'other-secret') })).toBe(false)
  })

  it('署名・シークレットが無ければ拒否する', () => {
    expect(verify({ signature: null })).toBe(false)
    expect(verify({ secret: '' })).toBe(false)
  })

  it('接頭辞の違う署名や長さの違う署名を拒否する(例外にしない)', () => {
    expect(verify({ signature: sign(BODY).replace('sha256=', 'sha1=') })).toBe(false)
    expect(verify({ signature: 'sha256=abc' })).toBe(false)
    expect(verify({ signature: `${sign(BODY)}あ` })).toBe(false)
  })
})
