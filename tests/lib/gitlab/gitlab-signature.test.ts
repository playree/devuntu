/**
 * GitLab Webhook の検証の単体テスト
 *
 * `/api/gitlab/webhook/[repositoryId]` は未認証で叩けるため、ここが唯一の門番になる。
 */

import {
  GITLAB_SIGNATURE_TOLERANCE_SEC,
  isValidGitlabSigningToken,
  verifyGitlabSignature,
  verifyGitlabToken,
} from '@/lib/gitlab/gitlab-signature'
import { describe, expect, it } from 'vitest'

// Standard Webhooks の仕様にあるテストベクタ
const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'
const ID = 'msg_p5jXN8AQM9LWM0D4loKWxJek'
const TIMESTAMP = '1614265330'
const BODY = '{"test": 2432232314}'
const SIGNATURE = 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE='
const NOW = Number(TIMESTAMP) * 1000

const verify = (override: Partial<Parameters<typeof verifyGitlabSignature>[0]> = {}) =>
  verifyGitlabSignature({
    secret: SECRET,
    id: ID,
    timestamp: TIMESTAMP,
    signature: SIGNATURE,
    rawBody: BODY,
    now: NOW,
    ...override,
  })

describe('verifyGitlabSignature', () => {
  it('正しい署名を受け入れる', () => {
    expect(verify()).toBe(true)
  })

  it('ボディ・ID・時刻のどれかが改ざんされていれば拒否する', () => {
    expect(verify({ rawBody: '{"test": 1}' })).toBe(false)
    expect(verify({ id: 'msg_other' })).toBe(false)
    expect(verify({ timestamp: String(Number(TIMESTAMP) + 1), now: NOW + 1000 })).toBe(false)
  })

  it('別の鍵で作られた署名を拒否する', () => {
    expect(verify({ secret: 'whsec_b3RoZXItc2VjcmV0LWtleQ==' })).toBe(false)
  })

  it('鍵のローテーション中は、空白区切りの署名のどれかが一致すれば受け入れる', () => {
    expect(verify({ signature: `v1,AAAA ${SIGNATURE}` })).toBe(true)
    expect(verify({ signature: 'v1,AAAA v1,BBBB' })).toBe(false)
  })

  it('バージョンの違う署名は受けない', () => {
    expect(verify({ signature: SIGNATURE.replace('v1,', 'v2,') })).toBe(false)
  })

  it('許容範囲を超えて古い・未来の配送はリプレイとみなして拒否する', () => {
    const tolerance = GITLAB_SIGNATURE_TOLERANCE_SEC * 1000
    expect(verify({ now: NOW + tolerance })).toBe(true)
    expect(verify({ now: NOW + tolerance + 1000 })).toBe(false)
    expect(verify({ now: NOW - tolerance - 1000 })).toBe(false)
  })

  it('ヘッダが欠けていれば拒否する', () => {
    expect(verify({ id: null })).toBe(false)
    expect(verify({ timestamp: null })).toBe(false)
    expect(verify({ signature: null })).toBe(false)
    expect(verify({ timestamp: 'abc' })).toBe(false)
  })

  it('鍵が読めなければ拒否する', () => {
    expect(verify({ secret: '' })).toBe(false)
    expect(verify({ secret: 'whsec_***' })).toBe(false)
  })
})

describe('isValidGitlabSigningToken', () => {
  it('whsec_ + base64 の形だけを受ける', () => {
    expect(isValidGitlabSigningToken(SECRET)).toBe(true)
    expect(isValidGitlabSigningToken('MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw')).toBe(false)
    expect(isValidGitlabSigningToken('whsec_')).toBe(false)
    expect(isValidGitlabSigningToken('whsec_***')).toBe(false)
  })
})

describe('verifyGitlabToken', () => {
  it('同じ値だけを受け入れる', () => {
    expect(verifyGitlabToken({ secret: 'token-value', token: 'token-value' })).toBe(true)
    expect(verifyGitlabToken({ secret: 'token-value', token: 'token-valuf' })).toBe(false)
    expect(verifyGitlabToken({ secret: 'token-value', token: 'token' })).toBe(false)
    expect(verifyGitlabToken({ secret: 'token-value', token: null })).toBe(false)
    expect(verifyGitlabToken({ secret: '', token: '' })).toBe(false)
  })
})
