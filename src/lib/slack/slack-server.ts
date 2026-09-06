/**
 * Slack Web API の呼び出し(サーバー専用)
 *
 * env-util / logger に依存するため、クライアントからは import しないこと。
 * (クライアント安全な定数・純粋関数は `slack.ts` を参照)
 *
 * 外部ライブラリ(@slack/web-api)は使わず fetch で叩く。必要なのは
 * chat.postMessage / chat.unfurl / auth.test / users.conversations /
 * openid.connect.userInfo だけで、SDK を持ち込むほどの規模ではない
 * (`google-calendar-server.ts` と同じ方針)。
 */

import { cached } from '../cache'
import { envu } from '../env-util'
import { logger } from '../logger'
import { sleep } from '../sleep'
import { classifySlackError, type SlackSendOutcome } from './slack'

const SLACK_API_BASE = 'https://slack.com/api/'
const USER_INFO_URL = `${SLACK_API_BASE}openid.connect.userInfo`

/** Slack が遅いときに通知処理を引きずらないための上限 */
const TIMEOUT_MS = 5000

/** レート制限で待てる上限。これを超える指示なら諦める(バックグラウンド処理を占有しない) */
const MAX_RETRY_AFTER_SEC = 5

/** auth.test の結果を使い回す時間。管理画面の接続状態表示のたびに Slack を叩かない */
const BOT_INFO_TTL_MS = 10 * 60 * 1000

/** チャンネル一覧を使い回す時間。設定画面を開くたびに Slack を叩かない */
const CHANNELS_TTL_MS = 5 * 60 * 1000

/** 1 回の users.conversations で取る件数(Slack の上限は 1000 だが、応答を軽く保つ) */
const CHANNELS_PAGE_SIZE = 200

/** ページングの上限。想定を超える規模のワークスペースで Slack を叩き続けないための歯止め */
const CHANNELS_MAX_PAGES = 5

/**
 * Slack Web API の共通レスポンス。
 * 失敗時も HTTP 200 を返し body の `ok` で成否を伝えるため、必ず `ok` を見る。
 */
type SlackApiResponse = { ok?: boolean; error?: string }

type SlackApiResult<T> = { ok: true; data: T } | { ok: false; error: string; retryAfterSec?: number }

/**
 * リクエストボディの形式。
 *
 * Slack が JSON ボディを受け付けるのは `chat.postMessage` / `chat.unfurl` のように
 * ドキュメントで `application/json` を明記しているメソッドだけで、`users.conversations` の
 * ような取得系は form-urlencoded しか受け付けない。
 *
 * 厄介なのは**取得系へ JSON を送ってもエラーにならず、パラメータだけが黙って無視される**こと。
 * `users.conversations` なら `types` が既定の `public_channel` に戻り、招待済みの
 * プライベートチャンネルが `ok: true` のまま返らなくなる(原因が分からない不具合になる)。
 * そのため既定値は置かず、呼び出しごとに必ず選ばせる。
 */
type SlackBodyEncoding = 'json' | 'form'

const encodeSlackBody = (body: Record<string, unknown>, encoding: SlackBodyEncoding) =>
  encoding === 'json'
    ? { contentType: 'application/json; charset=utf-8', payload: JSON.stringify(body) }
    : {
        contentType: 'application/x-www-form-urlencoded; charset=utf-8',
        // 真偽値・数値も Slack はクエリ文字列として受けるので、そのまま文字列化する
        payload: new URLSearchParams(Object.entries(body).map(([key, value]) => [key, String(value)])).toString(),
      }

/**
 * Slack Web API を 1 回叩く。HTTP レイヤの失敗も Slack の error コードへ寄せて返し、
 * 呼び出し側が `classifySlackError` だけで分岐できるようにする。
 */
const callSlackApi = async <T extends SlackApiResponse>(
  method: string,
  token: string,
  body: Record<string, unknown>,
  encoding: SlackBodyEncoding,
): Promise<SlackApiResult<T>> => {
  const { contentType, payload } = encodeSlackBody(body, encoding)

  let res: Response
  try {
    res = await fetch(`${SLACK_API_BASE}${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
      },
      body: payload,
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
 * Bot トークンで 1 メソッドを叩く。レート制限は短時間なら一度だけ待って再送する。
 *
 * 応答の中身が要る呼び出し(一覧取得など)のためにこちらを本体とし、
 * 成否だけで足りる送信系は {@link callWithBotToken} を通す。
 */
const callBotApi = async <T extends SlackApiResponse>(
  method: string,
  body: Record<string, unknown>,
  encoding: SlackBodyEncoding,
): Promise<SlackApiResult<T>> => {
  const token = envu.server.SLACK_BOT_TOKEN
  if (!token) {
    return { ok: false, error: 'not_authed' }
  }

  const send = () => callSlackApi<T>(method, token, body, encoding)

  const res = await send()
  if (res.ok || classifySlackError(res.error) !== 'rate_limited') {
    return res
  }

  const waitSec = res.retryAfterSec ?? 1
  if (waitSec > MAX_RETRY_AFTER_SEC) {
    logger.warn({ waitSec, method }, 'slack call gave up on rate limit')
    return res
  }
  await sleep(waitSec * 1000)
  return send()
}

/**
 * Bot トークンで 1 メソッドを叩き、結果を分類して返す。
 *
 * 通知 / プレビューはどちらもチケット操作の付随処理なので例外は投げず、
 * 後処理の判断材料だけを返す。
 */
const callWithBotToken = async (
  method: string,
  body: Record<string, unknown>,
  label: string,
): Promise<SlackSendOutcome> => {
  // 送信系(chat.*)は Block Kit の構造をそのまま渡せる JSON を使う
  const res = await callBotApi(method, body, 'json')
  if (res.ok) {
    return 'ok'
  }

  const outcome = classifySlackError(res.error)
  // 宛先不明は個別にスキップすればよいが、トークン失効は全滅するので重く扱う
  const log = outcome === 'revoked' ? logger.error : logger.warn
  log.call(logger, { error: res.error, outcome, method }, `slack ${label} failed`)
  return outcome
}

/**
 * Bot からメッセージを投稿する。
 *
 * chat.postMessage の channel はチャンネルID(`C...`)でもユーザーID(`U...`)でもよく、
 * 後者は Bot との 1:1 会話(DM)になる。どちらも必要なスコープは `chat:write` で同じだが、
 * チャンネルへは Bot が招待されている必要がある(未招待は `not_in_channel`)。
 */
export const postSlackMessage = (
  channel: string,
  message: { text: string; blocks: unknown[] },
): Promise<SlackSendOutcome> => callWithBotToken('chat.postMessage', { channel, ...message }, 'message')

/**
 * 展開先の指定。`link_shared` が渡してくる `unfurl_id` + `source` か、
 * 投稿済みメッセージの `channel` + `ts` のどちらかで指定する。
 */
export type SlackUnfurlTarget = { unfurlId: string; source: string } | { channel: string; ts: string }

/**
 * メッセージ内のリンクをプレビュー展開する(`link_shared` への応答)。
 *
 * `unfurls` は URL をキーにした map。JSON 文字列で渡す形は form-encoded 送信時の仕様で、
 * ここは JSON ボディなのでオブジェクトのまま渡す。
 */
export const unfurlSlackLinks = (
  target: SlackUnfurlTarget,
  unfurls: Record<string, { blocks: unknown[] }>,
): Promise<SlackSendOutcome> => {
  const destination =
    'unfurlId' in target
      ? { unfurl_id: target.unfurlId, source: target.source }
      : { channel: target.channel, ts: target.ts }
  return callWithBotToken('chat.unfurl', { ...destination, unfurls }, 'unfurl')
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

  try {
    // 失敗を null で返すと TTL の間キャッシュされ、トークンを直しても反映されない。
    // cached は reject した Promise を残さないので、失敗は throw で伝える
    return await cached('slack:auth-test', BOT_INFO_TTL_MS, async () => {
      const res = await callSlackApi<AuthTestResponse>('auth.test', token, {}, 'form')
      if (!res.ok) {
        throw new Error(res.error)
      }
      const { team_id: teamId, team, url } = res.data
      if (!teamId) {
        throw new Error('team_id is missing')
      }
      return { teamId, team: team ?? teamId, url: url ?? '' }
    })
  } catch (error) {
    logger.warn({ error }, 'slack auth.test failed')
    return null
  }
}

type SlackConversationsResponse = SlackApiResponse & {
  channels?: { id?: string; name?: string; is_private?: boolean }[]
  response_metadata?: { next_cursor?: string }
}

/** 設定画面のプルダウンに出すチャンネル */
export type SlackChannel = { id: string; name: string; isPrivate: boolean }

/**
 * Bot が参加しているチャンネルを取得する。
 *
 * `conversations.list` ではなく `users.conversations` を使う。前者は Bot が未参加の公開
 * チャンネルまで返すため、選んでも投稿時に `not_in_channel` で失敗するものが一覧に混ざる。
 * 後者なら「一覧に出ている = 必ず投稿できる」が成立し、招待漏れによる設定ミスが起きない。
 *
 * 取得できない場合は null を返し、画面側で案内文言に落とす(空配列と区別しない)。
 */
export const listSlackChannels = async (): Promise<SlackChannel[] | null> => {
  try {
    // 失敗を null で返すと TTL の間キャッシュされ、招待やトークンを直しても反映されない。
    // cached は reject した Promise を残さないので、失敗は throw で伝える
    return await cached('slack:channels', CHANNELS_TTL_MS, async () => {
      const channels: SlackChannel[] = []
      let cursor: string | undefined

      for (let page = 0; page < CHANNELS_MAX_PAGES; page++) {
        const res = await callBotApi<SlackConversationsResponse>(
          'users.conversations',
          {
            types: 'public_channel,private_channel',
            exclude_archived: true,
            limit: CHANNELS_PAGE_SIZE,
            ...(cursor && { cursor }),
          },
          // 取得系は form のみ。JSON だと types が既定へ戻り、プライベートチャンネルが返らない
          'form',
        )
        if (!res.ok) {
          throw new Error(res.error)
        }

        for (const { id, name, is_private: isPrivate } of res.data.channels ?? []) {
          // 名前の無い会話(DM など)は設定画面に出しても選べないので落とす
          if (id && name) {
            channels.push({ id, name, isPrivate: !!isPrivate })
          }
        }

        cursor = res.data.response_metadata?.next_cursor || undefined
        if (!cursor) {
          return channels.sort((a, b) => a.name.localeCompare(b.name))
        }
      }

      logger.warn({ pages: CHANNELS_MAX_PAGES, count: channels.length }, 'slack channel list truncated')
      return channels.sort((a, b) => a.name.localeCompare(b.name))
    })
  } catch (error) {
    logger.warn({ error }, 'slack users.conversations failed')
    return null
  }
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

  // chat.postMessage の channel へそのまま渡せる Slack ユーザーID
  const id = profile['https://slack.com/user_id'] ?? profile.sub
  if (!id || !profile.name || !profile.email) {
    logger.warn({ hasId: !!id, hasName: !!profile.name, hasEmail: !!profile.email }, 'slack userinfo is incomplete')
    return null
  }

  return {
    // slack() プリセットの accountSubject が sub を見て account.accountId を決めるため、
    // Slack ユーザーIDを sub として返す
    sub: id,
    name: profile.name,
    email: profile.email,
    image: profile.picture,
    emailVerified: profile.email_verified ?? false,
  }
}
