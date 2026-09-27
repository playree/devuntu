/**
 * GitLab Webhook の検証(サーバー専用)
 *
 * `/api/gitlab/webhook/[repositoryId]` は未認証で叩けるエンドポイントなので、ここが唯一の門番になる。
 * 判定は引数だけで決まる純粋関数にしてテストの対象にする。
 *
 * - 署名トークン(GitLab 19.0 以降、推奨): Standard Webhooks と同じ形式。
 *   `"{webhook-id}.{webhook-timestamp}.{body}"` の HMAC-SHA256 を base64 にして `v1,` を付けたものが
 *   `webhook-signature` に入る(鍵のローテーション中は空白区切りで複数並ぶ)
 * - シークレットトークン(19.0 未満向け): `X-Gitlab-Token` に登録した値がそのまま入る
 *
 * `node:crypto` を使うためクライアントからは import しないこと。
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { GITLAB_SIGNING_TOKEN_PATTERN } from './gitlab'

const SECRET_PREFIX = 'whsec_'
const SIGNATURE_VERSION = 'v1,'

/** 受け付ける時刻のずれ(秒)。これより古い / 未来の配送はリプレイとみなして拒否する */
export const GITLAB_SIGNATURE_TOLERANCE_SEC = 5 * 60

const safeEqual = (a: string, b: string): boolean => {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  // timingSafeEqual はバイト長が違うと例外を投げるので、先に弾く(長さ自体は秘密ではない)
  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf)
}

/** `whsec_<base64>` から鍵のバイト列を取り出す。読めなければ null */
const decodeSigningKey = (secret: string): Buffer | null => {
  const encoded = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    return null
  }
  const key = Buffer.from(encoded, 'base64')
  return key.length > 0 ? key : null
}

/** 署名トークンとして受け付ける形か。画面から貼られた値の確認に使う */
export const isValidGitlabSigningToken = (secret: string): boolean =>
  GITLAB_SIGNING_TOKEN_PATTERN.test(secret) && decodeSigningKey(secret) !== null

export type GitlabSignatureParam = {
  /** 署名トークン(`whsec_...`) */
  secret: string
  /** `webhook-id` ヘッダ */
  id: string | null
  /** `webhook-timestamp` ヘッダ(UNIX 秒) */
  timestamp: string | null
  /** `webhook-signature` ヘッダ */
  signature: string | null
  /** リクエストの生ボディ。署名は生の文字列に対して計算される */
  rawBody: string
  /** 現在時刻(ミリ秒)。テストで固定するため引数にする */
  now: number
}

/** 署名トークンで Webhook を検証する */
export const verifyGitlabSignature = ({
  secret,
  id,
  timestamp,
  signature,
  rawBody,
  now,
}: GitlabSignatureParam): boolean => {
  if (!id || !timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) {
    return false
  }
  if (Math.abs(now / 1000 - Number(timestamp)) > GITLAB_SIGNATURE_TOLERANCE_SEC) {
    return false
  }
  const key = decodeSigningKey(secret)
  if (!key) {
    return false
  }

  const expected = `${SIGNATURE_VERSION}${createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64')}`
  // 途中で抜けずに全部比べる(どれが一致したかで処理時間を変えない)
  let matched = false
  for (const candidate of signature.split(' ')) {
    if (safeEqual(expected, candidate)) {
      matched = true
    }
  }
  return matched
}

/** シークレットトークンで Webhook を検証する */
export const verifyGitlabToken = ({ secret, token }: { secret: string; token: string | null }): boolean =>
  !!secret && !!token && safeEqual(secret, token)
