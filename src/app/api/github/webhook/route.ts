import { envu } from '@/lib/env-util'
import { verifyGithubSignature } from '@/lib/github/github-signature'
import { handleGithubEvent } from '@/lib/github/github-webhook'
import { logger } from '@/lib/logger'
import { readLimitedBody } from '@/lib/request-body'

/**
 * GitHub Webhook の受け口(PR の状態・CI の結果の反映と、マージによるチケットの自動完了)。
 *
 * `src/proxy.ts` は `api/` の認証を素通しにしているため未認証で叩ける。
 * GitHub が付ける署名だけが門番なので、検証を通す前に本文を解釈しないこと。
 */

/** 受け付ける本文の上限。GitHub は 25MB で配送を打ち切るが、扱うイベントの payload は数十KB に収まる */
const MAX_BODY_BYTES = 5 * 1024 * 1024

export const POST = async (request: Request) => {
  const secret = envu.server.GITHUB_WEBHOOK_SECRET
  if (!secret) {
    // 未設定ならこの機能ごと無効。エンドポイントの存在も伏せる
    return new Response(null, { status: 404 })
  }

  const rawBody = await readLimitedBody(request, MAX_BODY_BYTES)
  if (rawBody === null) {
    logger.warn('github webhook body too large')
    return new Response(null, { status: 413 })
  }

  const valid = verifyGithubSignature({
    secret,
    signature: request.headers.get('x-hub-signature-256'),
    rawBody,
  })
  if (!valid) {
    logger.warn('github webhook signature mismatch')
    return new Response(null, { status: 401 })
  }

  let body: unknown
  try {
    // Webhook の Content type は application/json で登録する(form 形式は受けない)
    body = JSON.parse(rawBody)
  } catch {
    return new Response(null, { status: 400 })
  }

  const event = request.headers.get('x-github-event') ?? ''
  const delivery = request.headers.get('x-github-delivery')
  logger.debug({ event, delivery }, 'github webhook')

  /**
   * GitHub の応答待ちは 10 秒あり、扱う処理は DB の更新だけなので応答の前に済ませる。
   * 失敗を 500 で返せば、GitHub の配送履歴から再送できる。
   */
  try {
    await handleGithubEvent(event, body)
  } catch (error) {
    logger.error({ error, event, delivery }, 'github webhook failed')
    return new Response(null, { status: 500 })
  }
  return new Response(null, { status: 204 })
}
