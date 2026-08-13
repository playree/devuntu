/**
 * Slack Web API の呼び出し(サーバー専用)
 *
 * env-util / logger に依存するため、クライアントからは import しないこと。
 * (クライアント安全な定数・純粋関数は `slack.ts` を参照)
 *
 * 外部ライブラリ(@slack/web-api)は使わず fetch で叩く。通知に必要なのは
 * chat.postMessage / auth.test / openid.connect.userInfo の 3 つだけで、
 * SDK を持ち込むほどの規模ではない(`google-calendar-server.ts` と同じ方針)。
 */

import { cached } from './cache'
import { envu } from './env-util'
import { logger } from './logger'
import { classifySlackError, type SlackSendOutcome } from './slack'
import { sleep } from './sleep'

const SLACK_API_BASE = 'https://slack.com/api/'
const USER_INFO_URL = `${SLACK_API_BASE}openid.connect.userInfo`

/** Slack が遅いときに通知処理を引きずらないための上限 */
const TIMEOUT_MS = 5000

/** レート制限で待てる上限。これを超える指示なら諦める(バックグラウンド処理を占有しない) */
const MAX_RETRY_AFTER_SEC = 5

/** auth.test の結果を使い回す時間。管理画面の接続状態表示のたびに Slack を叩かない */
const BOT_INFO_TTL_MS = 10 * 60 * 1000

/**
 * Slack Web API の共通レスポンス。
 * 失敗時も HTTP 200 を返し body の `ok` で成否を伝えるため、必ず `ok` を見る。
 */
type SlackApiResponse = { ok?: boolean; error?: string }

type SlackApiResult<T> = { ok: true; data: T } | { ok: false; error: string; retryAfterSec?: number }

/**
 * Slack Web API を 1 回叩く。HTTP レイヤの失敗も Slack の error コードへ寄せて返し、
 * 呼び出し側が `classifySlackError` だけで分岐できるようにする。
 */
const callSlackApi = async <T extends SlackApiResponse>(
  method: string,
  token: string,
  body: Record<string, unknown>,
): Promise<SlackApiResult<T>> => {
  let res: Response
  try {
    res = await fetch(`${SLACK_API_BASE}${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    // ネットワーク断・タイムアウト。トークンはログに出さない
    logger.warn({ error, method }, 'slack api request failed')
    return { ok: false, error: 'request_timeout' }
  }

  if (res.status === 429) {
    const retryAfterSec = Number(res.headers.get('retry-after')) || 1
    return { ok: false, error: 'ratelimited', retryAfterSec }
  }
  if (res.status >= 500) {
    return { ok: false, error: 'service_unavailable' }
  }

  let data: T
  try {
    data = (await res.json()) as T
  } catch (error) {
    logger.warn({ error, method, status: res.status }, 'slack api returned invalid json')
    return { ok: false, error: 'invalid_response' }
  }

  if (!data.ok) {
    return { ok: false, error: data.error ?? 'unknown_error' }
  }
  return { ok: true, data }
}

/**
 * Slack ユーザーへ Bot から DM を送る。
 *
 * chat.postMessage の channel にユーザーID(`U...`)を渡すと Bot との 1:1 会話になる。
 * 通知は付随処理なので例外は投げず、後処理の判断材料だけを返す。
 */
export const postSlackDm = async (
  slackUserId: string,
  message: { text: string; blocks: unknown[] },
): Promise<SlackSendOutcome> => {
  const token = envu.server.SLACK_BOT_TOKEN
  if (!token) {
    return 'revoked'
  }

  const send = () => callSlackApi('chat.postMessage', token, { channel: slackUserId, ...message })

  let res = await send()
  if (!res.ok && classifySlackError(res.error) === 'rate_limited') {
    const waitSec = res.retryAfterSec ?? 1
    if (waitSec > MAX_RETRY_AFTER_SEC) {
      logger.warn({ waitSec }, 'slack dm gave up on rate limit')
      return 'rate_limited'
    }
    await sleep(waitSec * 1000)
    res = await send()
  }

  if (res.ok) {
    return 'ok'
  }

  const outcome = classifySlackError(res.error)
  // 宛先不明は個別にスキップすればよいが、トークン失効は全滅するので重く扱う
  const log = outcome === 'revoked' ? logger.error : logger.warn
  log.call(logger, { error: res.error, outcome }, 'slack dm not delivered')
  return outcome
}

type AuthTestResponse = SlackApiResponse & { team?: string; team_id?: string; url?: string }

export type SlackBotInfo = { teamId: string; team: string; url: string }

/**
 * Bot トークンの接続先ワークスペースを取得する。
 * 管理画面の接続状態表示に使うため、トークン不正時は null を返して画面側で案内させる。
 */
export const getSlackBotInfo = async (): Promise<SlackBotInfo | null> => {
  const token = envu.server.SLACK_BOT_TOKEN
  if (!token) {
    return null
  }

  return cached('slack:auth-test', BOT_INFO_TTL_MS, async () => {
    const res = await callSlackApi<AuthTestResponse>('auth.test', token, {})
    if (!res.ok) {
      logger.warn({ error: res.error }, 'slack auth.test failed')
      return null
    }
    const { team_id: teamId, team, url } = res.data
    if (!teamId) {
      return null
    }
    return { teamId, team: team ?? teamId, url: url ?? '' }
  })
}

type SlackUserInfoResponse = SlackApiResponse & {
  sub?: string
  name?: string
  email?: string
  email_verified?: boolean
  picture?: string
  'https://slack.com/user_id'?: string
  'https://slack.com/team_id'?: string
}

/**
 * genericOAuth の `getUserInfo` に差し込む userinfo 取得。
 *
 * better-auth 同梱の `slack()` プリセットの実装を置き換える。プリセットは
 * HTTP エラーしか見ないため、Slack が 200 + `ok:false` を返したときに name が
 * undefined となり `name_is_missing` という無関係なエラーで終わってしまう。
 * ここで `ok` を検査し、ワークスペースの一致も入口で確かめる。
 *
 * null を返すと better-auth は `user_info_is_missing` としてエラー画面へ回す。
 */
export const slackUserInfo = async (tokens: { accessToken?: string }) => {
  const accessToken = tokens.accessToken
  if (!accessToken) {
    return null
  }

  let profile: SlackUserInfoResponse
  try {
    const res = await fetch(USER_INFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    profile = (await res.json()) as SlackUserInfoResponse
  } catch (error) {
    logger.warn({ error }, 'slack userinfo request failed')
    return null
  }

  if (!profile.ok) {
    logger.warn({ error: profile.error }, 'slack userinfo returned not ok')
    return null
  }

  // 別ワークスペースのアカウントを紐付けても DM は届かないので、連携の入口で弾く
  const expectedTeamId = envu.server.SLACK_TEAM_ID
  const teamId = profile['https://slack.com/team_id']
  if (expectedTeamId && teamId !== expectedTeamId) {
    logger.warn({ teamId, expectedTeamId }, 'slack workspace mismatch')
    return null
  }

  // chat.postMessage の channel へそのまま渡せる Slack ユーザーIDを id にする
  const id = profile['https://slack.com/user_id'] ?? profile.sub
  if (!id || !profile.name || !profile.email) {
    logger.warn({ hasId: !!id, hasName: !!profile.name }, 'slack userinfo is incomplete')
    return null
  }

  return {
    id,
    name: profile.name,
    email: profile.email,
    image: profile.picture,
    emailVerified: profile.email_verified ?? false,
  }
}
