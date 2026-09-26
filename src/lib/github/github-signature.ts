/**
 * GitHub Webhook の署名検証(サーバー専用)
 *
 * `/api/github/webhook` は未認証で叩けるエンドポイントなので、GitHub が付ける署名だけが
 * 唯一の門番になる。判定は引数だけで決まる純粋関数にしてテストの対象にする。
 *
 * `node:crypto` を使うためクライアントからは import しないこと。
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

const PREFIX = 'sha256='

export type GithubSignatureParam = {
  secret: string
  /** `X-Hub-Signature-256` ヘッダ(`sha256=<hex>`) */
  signature: string | null
  /** リクエストの生ボディ。署名は生の文字列に対して計算される */
  rawBody: string
}

/**
 * GitHub の Webhook 署名を検証する。
 *
 * GitHub の署名にはタイムスタンプが含まれないため、再送(リプレイ)はここでは防げない。
 * 受け側の更新は GitHub 側の updated_at と比べて古いものを捨てるので、再送されても状態は巻き戻らない。
 */
export const verifyGithubSignature = ({ secret, signature, rawBody }: GithubSignatureParam): boolean => {
  if (!secret || !signature) {
    return false
  }

  const expected = `${PREFIX}${createHmac('sha256', secret).update(rawBody).digest('hex')}`

  // timingSafeEqual はバイト長が違うと例外を投げるので、先に弾く(長さ自体は秘密ではない)
  const expectedBuf = Buffer.from(expected)
  const signatureBuf = Buffer.from(signature)
  if (expectedBuf.length !== signatureBuf.length) {
    return false
  }
  return timingSafeEqual(expectedBuf, signatureBuf)
}
