/**
 * Slack 連携ユーティリティ
 *
 * NOTE: このファイルはクライアント('use client')からも import されるため、
 * サーバー専用の処理(prisma / Slack API 呼び出しなど)は `slack-server.ts` に配置する。
 */

import { truncate } from './text-util'

/** Slack 連携用の OAuth プロバイダ ID */
export const SLACK_PROVIDER_ID = 'slack'

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
    // Bot が会話に参加していない。unfurl では招待されるまでどの投稿も展開できない
    case 'not_in_channel':
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

/**
 * `*<url|ラベル>*` の mrkdwn リンクを組み立てる。
 *
 * 組み立ててから上限で切ると閉じの `>*` まで落ちてリンク記法が壊れるため、
 * 記法の分を差し引いた残りをラベルの予算にして先に詰める。
 * URL だけで上限に届く場合はリンクを諦めてラベルだけ返す(壊れた記法よりましなため)。
 */
const boldLink = (url: string, label: string, max: number) => {
  const budget = max - `*<${url}|>*`.length
  return budget > 0 ? `*<${url}|${truncate(label, budget)}>*` : truncate(label, max)
}

/** section の fields が受け付ける要素数の上限。超えると invalid_blocks で落ちる */
const SECTION_FIELDS_MAX = 10

/** fields の 1 要素あたりの上限 */
const FIELD_TEXT_MAX = 2000

export type TicketUnfurlParam = {
  /**
   * 見出しのリンク先。
   * 貼られた文字列ではなく自前で組み立てた正規形を渡すこと(`>` などで mrkdwn が崩れる)。
   */
  url: string
  /** 表示ID(`KEY-番号`) */
  displayId: string
  /** チケット名。利用者入力を含むのでエスケープ前の生文字列を渡す */
  title: string
  /** 見出しの下に 2 列で並べる項目。値が空のものは呼び出し側で落とさなくてよい */
  fields: { label: string; value: string }[]
}

/**
 * チケットURLのプレビュー(chat.unfurl の attachment)ブロックを組み立てる。
 *
 * unfurl はチャンネルの全員に見えるため、貼った本人に閲覧権限があることを
 * 呼び出し側(`slack-unfurl.ts`)で確認した上で渡すこと。
 */
export const buildTicketUnfurlBlocks = ({ url, displayId, title, fields }: TicketUnfurlParam): unknown[] => {
  const heading = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: boldLink(url, `[${escapeSlackText(displayId)}] ${escapeSlackText(title)}`, SECTION_TEXT_MAX),
    },
  }

  const filled = fields
    .filter(({ value }) => !!value)
    .slice(0, SECTION_FIELDS_MAX)
    .map(({ label, value }) => ({
      type: 'mrkdwn',
      text: truncate(`*${escapeSlackText(label)}*\n${escapeSlackText(value)}`, FIELD_TEXT_MAX),
    }))

  return filled.length > 0 ? [heading, { type: 'section', fields: filled }] : [heading]
}

export type MentionMessageParam = {
  /** 見出し(表示ID + チケット名)。利用者入力を含むのでエスケープ前の生文字列を渡す */
  subject: string
  /** チケットを開く URL */
  url: string
  /** 「〇〇さんがメンションしました」の本文。呼び出し側でロケール解決済みのものを渡す */
  body: string
  /** コメント本文の抜粋。引用として本文の下に出す。利用者入力を含むので生文字列を渡す */
  excerpt?: string
  /** ボタンのラベル */
  openLabel: string
}

/**
 * 上限に収まる範囲で行を積む。
 *
 * 予算を使い切った行は落とす(中途半端に 1 文字だけ残すより、その行が無い方が読める)。
 * 各行の前に入る改行 1 文字も予算に含める。
 */
const fitLines = (lines: string[], max: number): string => {
  const fitted: string[] = []
  let budget = max

  for (const line of lines) {
    // 先頭行以外は改行の分を差し引く
    const room = fitted.length === 0 ? budget : budget - 1
    if (!line || room <= 0) {
      continue
    }
    const text = truncate(line, room)
    fitted.push(text)
    budget = room - text.length
  }

  return fitted.join('\n')
}

/**
 * メンション通知の chat.postMessage ペイロードを組み立てる。
 *
 * `text` は通知バナー / プッシュ通知のフォールバックに使われるため必ず埋める
 * (blocks だけだと通知に本文が出ない)。抜粋もここに含めて、開かなくても内容が分かるようにする。
 */
export const buildMentionMessage = ({ subject, url, body, excerpt, openLabel }: MentionMessageParam) => {
  const safeSubject = escapeSlackText(subject)
  const safeBody = escapeSlackText(body)
  // mrkdwn の引用。抜粋は改行を畳んだ 1 行で渡ってくる前提
  const quoted = excerpt ? `>${escapeSlackText(excerpt)}` : ''

  // 見出しのリンクを先に確定させ、余った分を本文・抜粋の順に割り当てる
  const heading = boldLink(url, safeSubject, SECTION_TEXT_MAX)

  return {
    text: fitLines([safeSubject, safeBody, quoted], SECTION_TEXT_MAX),
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: fitLines([heading, safeBody, quoted], SECTION_TEXT_MAX),
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
