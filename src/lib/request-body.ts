/**
 * 未認証で叩ける Webhook の受け口(Slack Events / GitHub)で本文を読む処理
 *
 * Route Handler には `next.config.ts` の `bodySizeLimit`(Server Actions 専用)が効かないため、
 * 無制限のバッファリングに晒さないよう自前で上限を設ける。
 */

/**
 * 上限まで本文を文字列で読む。超えたら読み取りを打ち切って null を返す。
 * Content-Length は詐称できるので、ヘッダの検査だけでなく読みながら実バイト数も数える。
 *
 * 署名は生ボディに対して計算されるため、`request.json()` ではなくこれで読んでから検証する
 * (パースして再度文字列化したものでは一致しない)。
 */
export const readLimitedBody = async (request: Request, maxBytes: number): Promise<string | null> => {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    return null
  }
  if (!request.body) {
    return ''
  }

  const reader = request.body.getReader()
  // stream: true でチャンク境界にまたがるマルチバイト文字を落とさない
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      size += value.byteLength
      if (size > maxBytes) {
        return null
      }
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return text + decoder.decode()
}
