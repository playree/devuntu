import { envu } from '@/lib/env-util'
import { logger } from '@/lib/logger'
import { readLimitedBody } from '@/lib/request-body'
import { verifySlackSignature } from '@/lib/slack/slack-signature'
import { handleSlackLinkShared, type SlackLinkSharedEvent } from '@/lib/slack/slack-unfurl'
import { after } from 'next/server'

/**
 * Slack Events API の受け口(チケットURLのプレビュー展開)。
 *
 * `src/proxy.ts` は `api/` の認証を素通しにしているため未認証で叩ける。
 * Slack が付ける署名だけが門番なので、検証を通す前に本文を解釈しないこと。
 */

type SlackEventPayload = {
  type?: string
  /** url_verification のときだけ入る。そのまま返すと Request URL が検証される */
  challenge?: string
  event?: SlackLinkSharedEvent & { type?: string }
}

/** 受け付ける本文の上限。Slack の Events payload は数KB に収まる */
const MAX_BODY_BYTES = 1024 * 1024

export const POST = async (request: Request) => {
  const signingSecret = envu.server.SLACK_SIGNING_SECRET
  if (!signingSecret) {
    // 未設定ならこの機能ごと無効。エンドポイントの存在も伏せる
    return new Response(null, { status: 404 })
  }

  const rawBody = await readLimitedBody(request, MAX_BODY_BYTES)
  if (rawBody === null) {
    logger.warn('slack event body too large')
    return new Response(null, { status: 413 })
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
    return new Response(null, { status: 401 })
  }

  let payload: SlackEventPayload
  try {
    payload = JSON.parse(rawBody) as SlackEventPayload
  } catch {
    return new Response(null, { status: 400 })
  }

  const event = payload.event
  // url_verification と実イベントがログ上で区別できるようにする
  logger.debug({ type: payload.type, eventType: event?.type }, 'slack event')

  if (payload.type === 'url_verification') {
    return Response.json({ challenge: payload.challenge })
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
  return new Response(null, { status: 200 })
}
