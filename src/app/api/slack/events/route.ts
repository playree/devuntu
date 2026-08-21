import { envu } from '@/lib/env-util'
import { logger } from '@/lib/logger'
import { verifySlackSignature } from '@/lib/slack/slack-signature'
import { handleSlackLinkShared, type SlackLinkSharedEvent } from '@/lib/slack/slack-unfurl'
import { after, NextResponse } from 'next/server'

/**
 * Slack Events API の受け口(チケットURLのプレビュー展開)。
 *
 * `src/proxy.ts` の matcher は `api/` を除外しているため未認証で叩ける。
 * Slack が付ける署名だけが門番なので、検証を通す前に本文を解釈しないこと。
 */

type SlackEventPayload = {
  type?: string
  /** url_verification のときだけ入る。そのまま返すと Request URL が検証される */
  challenge?: string
  event?: SlackLinkSharedEvent & { type?: string }
}

/**
 * 受け付ける本文の上限。Slack の Events payload は数KB に収まる。
 * Route Handler には `next.config.ts` の `bodySizeLimit`(Server Actions 専用)が効かないため、
 * 未認証で叩けるこのエンドポイントを無制限のバッファリングに晒さないよう自前で止める。
 */
const MAX_BODY_BYTES = 1024 * 1024

/**
 * 上限まで本文を読む。超えたら読み取りを打ち切って null を返す。
 * Content-Length は詐称できるので、ヘッダの検査だけでなく読みながら実バイト数も数える。
 */
const readBody = async (request: Request): Promise<string | null> => {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
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
      if (size > MAX_BODY_BYTES) {
        return null
      }
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return text + decoder.decode()
}

export const POST = async (request: Request) => {
  const signingSecret = envu.server.SLACK_SIGNING_SECRET
  if (!signingSecret) {
    // 未設定ならこの機能ごと無効。エンドポイントの存在も伏せる
    return new NextResponse(null, { status: 404 })
  }

  /**
   * 署名は生ボディに対して計算されるため、`request.json()` より先に文字列で読む
   * (パースして再度文字列化したものでは一致しない)。
   */
  const rawBody = await readBody(request)
  if (rawBody === null) {
    logger.warn('slack event body too large')
    return new NextResponse(null, { status: 413 })
  }

  const valid = verifySlackSignature({
    signingSecret,
    timestamp: request.headers.get('x-slack-request-timestamp'),
    signature: request.headers.get('x-slack-signature'),
    rawBody,
    nowMs: Date.now(),
  })
  if (!valid) {
    logger.warn('slack event signature mismatch')
    return new NextResponse(null, { status: 401 })
  }

  let payload: SlackEventPayload
  try {
    payload = JSON.parse(rawBody) as SlackEventPayload
  } catch {
    return new NextResponse(null, { status: 400 })
  }

  const event = payload.event
  // url_verification と実イベントがログ上で区別できるようにする
  logger.debug({ type: payload.type, eventType: event?.type }, 'slack event')

  if (payload.type === 'url_verification') {
    return NextResponse.json({ challenge: payload.challenge })
  }

  if (payload.type === 'event_callback' && event?.type === 'link_shared') {
    /**
     * Slack は 3 秒以内の応答を要求し、遅いと同じイベントを再送してくる。
     * チケットの照会と chat.unfurl は応答を返したあとで行う。
     */
    after(async () => {
      try {
        await handleSlackLinkShared(event)
      } catch (error) {
        logger.error({ error }, 'slack unfurl failed')
      }
    })
  }

  // 想定外の type も 200 で受け切る(再送させない)
  return new NextResponse(null, { status: 200 })
}
