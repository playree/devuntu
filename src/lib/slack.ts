/**
 * Slack 連携ユーティリティ
 *
 * NOTE: このファイルはクライアント('use client')からも import されるため、
 * サーバー専用の処理(prisma / Slack API 呼び出しなど)は `slack-server.ts` に配置する。
 */

import type { NotifyEvent } from '@/generated/prisma/enums'

/** Slack 連携用の OAuth プロバイダ ID */
export const SLACK_PROVIDER_ID = 'slack'

/** 通知イベントの種別。Prisma の enum と同じ並びで持つ(tests/lib/slack.test.ts で一致を固定する) */
export const NOTIFY_EVENTS = ['mention'] as const satisfies readonly NotifyEvent[]

/** 1回のメンションで DM を送る上限。暴走時に Slack を叩き続けないための歯止め */
export const MAX_SLACK_RECIPIENTS = 20

/** Block Kit の section が受け付ける mrkdwn の上限。超えると chat.postMessage が invalid_blocks で落ちる */
const SECTION_TEXT_MAX = 3000

/** 送信結果の分類。呼び出し側はこれだけを見て後処理を決める */
export type SlackSendOutcome =
  /** 送信成功 */
  | 'ok'
  /** 宛先の Slack ユーザーが見つからない。その宛先だけ諦める */
  | 'unlinked'
  /** Bot トークンが無効。以降の宛先も全滅するので送信を打ち切る */
  | 'revoked'
  /** レート制限。Retry-After に従って一度だけ再送する */
  | 'rate_limited'
  /** Slack 側の一時障害 */
  | 'retryable'
  /** その他・未知のエラー */
  | 'failed'

/**
 * Slack の error コードを後処理の分類へ落とす。
 * 未知のコードは 'failed' に寄せ、送信を止めない(新しいコードが増えても壊れないようにする)。
 */
export const classifySlackError = (error: string | undefined): SlackSendOutcome => {
  switch (error) {
    case undefined:
      return 'failed'
    case 'channel_not_found':
    case 'user_not_found':
    case 'users_not_found':
    case 'is_bot':
      return 'unlinked'
    case 'token_revoked':
    case 'token_expired':
    case 'account_inactive':
    case 'invalid_auth':
    case 'not_authed':
      return 'revoked'
    case 'ratelimited':
    case 'rate_limited':
      return 'rate_limited'
    case 'service_unavailable':
    case 'fatal_error':
    case 'internal_error':
    case 'request_timeout':
      return 'retryable'
    default:
      return 'failed'
  }
}

/**
 * Slack mrkdwn のエスケープ。
 *
 * 利用者の入力(チケットのタイトルなど)をそのまま流すと `<!channel>` や `<@U123>` が
 * 特殊記法として解釈されてしまうため、メッセージに載せる前に必ず通す。
 * `&` を最初に置換しないと、後続の置換が生んだ `&lt;` をさらに変換して二重エスケープになる。
 */
export const escapeSlackText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 上限を超える分を切り捨てる。末尾に省略記号を付けて途中で切れたことを示す */
const truncate = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`)

export type MentionMessageParam = {
  /** 見出し(表示ID + チケット名)。利用者入力を含むのでエスケープ前の生文字列を渡す */
  subject: string
  /** チケットを開く URL */
  url: string
  /** 「〇〇さんがメンションしました」の本文。呼び出し側でロケール解決済みのものを渡す */
  body: string
  /** ボタンのラベル */
  openLabel: string
}

/**
 * メンション通知の chat.postMessage ペイロードを組み立てる。
 *
 * `text` は通知バナー / プッシュ通知のフォールバックに使われるため必ず埋める
 * (blocks だけだと通知に本文が出ない)。
 */
export const buildMentionMessage = ({ subject, url, body, openLabel }: MentionMessageParam) => {
  const safeSubject = escapeSlackText(subject)
  const safeBody = escapeSlackText(body)

  return {
    text: truncate(`${subject}\n${body}`, SECTION_TEXT_MAX),
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: truncate(`*<${url}|${safeSubject}>*\n${safeBody}`, SECTION_TEXT_MAX),
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: openLabel },
            url,
          },
        ],
      },
    ],
  }
}
