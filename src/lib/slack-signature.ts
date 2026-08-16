/**
 * Slack からのリクエスト署名の検証(サーバー専用)
 *
 * `/api/slack/events` は未認証で叩けるエンドポイントなので、Slack が付ける署名だけが
 * 唯一の門番になる。判定は引数だけで決まる純粋関数にして `tests/lib/slack-signature.test.ts`
 * の対象にする(env / prisma / logger には依存させない)。
 *
 * `node:crypto` を使うためクライアントからは import しないこと。
 * (クライアント安全な定数・純粋関数は `slack.ts` を参照)
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/** 署名のバージョン。Slack が v1 を出すまではこの固定値 */
const VERSION = 'v0'

/**
 * 受け付けるタイムスタンプのずれ。Slack の推奨値。
 * 傍受したリクエストの再送(リプレイ)を、署名が有効なまま通し続けさせない。
 */
export const MAX_CLOCK_SKEW_SEC = 60 * 5

export type SlackSignatureParam = {
  signingSecret: string
  /** `X-Slack-Request-Timestamp` ヘッダ(エポック秒) */
  timestamp: string | null
  /** `X-Slack-Signature` ヘッダ(`v0=<hex>`) */
  signature: string | null
  /**
   * リクエストの生ボディ。
   * 署名は生の文字列に対して計算されるため、JSON へパースしたものを再度文字列化しても一致しない。
   */
  rawBody: string
  /** 判定基準の現在時刻(ミリ秒)。テストから固定できるよう引数で受ける */
  nowMs: number
}

/**
 * Slack のリクエスト署名を検証する。
 *
 * 署名の一致は `timingSafeEqual` で比較する。文字列の `===` は先頭から一致する長さだけ
 * 時間が延びるため、応答時間の差から正しい署名を 1 文字ずつ探れてしまう。
 */
export const verifySlackSignature = ({
  signingSecret,
  timestamp,
  signature,
  rawBody,
  nowMs,
}: SlackSignatureParam): boolean => {
  if (!signingSecret || !timestamp || !signature) {
    return false
  }

  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) {
    return false
  }
  if (Math.abs(nowMs / 1000 - ts) > MAX_CLOCK_SKEW_SEC) {
    return false
  }

  const expected = `${VERSION}=${createHmac('sha256', signingSecret).update(`${VERSION}:${timestamp}:${rawBody}`).digest('hex')}`

  /**
   * timingSafeEqual はバイト長が違うと例外を投げるので、先に弾く(長さ自体は秘密ではない)。
   * 文字数ではなくバイト長で見ること。非 ASCII が混ざると両者がずれて素通りしてしまう。
   */
  const expectedBuf = Buffer.from(expected)
  const signatureBuf = Buffer.from(signature)
  if (expectedBuf.length !== signatureBuf.length) {
    return false
  }
  return timingSafeEqual(expectedBuf, signatureBuf)
}
