/**
 * Slack に貼られたチケットURLのプレビュー展開(サーバー専用)
 *
 * `link_shared` イベントの入口。`/api/slack/events` はここだけを呼ぶ。
 *
 * unfurl はチャンネルの全員に見えるため、**リンクを貼った本人の閲覧権限**を必ず確認してから
 * 展開する。権限が無い / 未連携の場合は何もしない(URL のまま残る)。
 * 展開しないこと自体はエラーではないので、どの段階でも例外は投げない。
 */

import { t } from '@/locale/server'
import { findTicketIdByDisplayId, getTicketAccess } from '../board'
import { dayformat } from '../day'
import { envu } from '../env-util'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { makeUrl } from '../server-utils'
import { buildTicketUnfurlBlocks, SLACK_PROVIDER_ID } from './slack'
import { canUseSlackAccount } from './slack-account'
import { unfurlSlackLinks, type SlackUnfurlTarget } from './slack-server'
import {
  parseTicketUrl,
  TICKET_PRIORITY_LOCALE,
  TICKET_STATUS_LOCALE,
  ticketDisplayId,
  ticketShortPath,
  type TicketUrlRef,
} from '../task'

/**
 * 1 メッセージあたりに展開するリンクの上限。
 * URL を大量に並べた 1 通で DB とチケット照会を引きずらないようにする。
 */
const MAX_UNFURL_LINKS = 5

/** 入力中のイベントで channel に入る値。実在のチャンネルではないので展開先には使えない */
const COMPOSER_CHANNEL = 'COMPOSER'

export type SlackLinkSharedEvent = {
  /** リンクを貼った Slack ユーザーID。Bot の投稿などでは省略される */
  user?: string
  channel?: string
  /** 投稿済みメッセージの識別子。`unfurl_id` が無いときのフォールバックに使う */
  message_ts?: string
  /**
   * 展開先の識別子。投稿済みメッセージでも入力中(`source: 'composer'`)でも付くので、
   * channel + message_ts より優先して使う。
   */
  unfurl_id?: string
  /** `conversations_history` / `composer` など、リンクが現れた文脈 */
  source?: string
  /**
   * Bot がその会話に参加しているか。
   *
   * Slack は `links:read` があると **Bot が参加していない公開チャンネルにもイベントを送る**。
   * そのまま chat.unfurl を呼んでも `not_in_channel` で失敗するので、手前で打ち切る。
   */
  is_bot_user_member?: boolean
  links?: { url?: string }[]
}

/** リンクを貼った Slack ユーザーを Devuntu のユーザーへ解決する。未連携・利用不可なら null */
const resolveSharedBy = async (slackUserId: string) => {
  const account = await prisma.account.findFirst({
    where: { providerId: SLACK_PROVIDER_ID, accountId: slackUserId },
    select: { userId: true },
  })
  if (!account) {
    return null
  }

  // 管理者による有効化と許可グループ。通知と同じ判定を使う
  if (!(await canUseSlackAccount(account.userId))) {
    return null
  }

  return prisma.user.findUnique({
    where: { id: account.userId },
    select: { id: true, role: true, locale: true },
  })
}

type SharedBy = NonNullable<Awaited<ReturnType<typeof resolveSharedBy>>>

/** チケット 1 件分のプレビュー。閲覧できない / 存在しない場合は null */
const buildUnfurl = async (user: SharedBy, ref: TicketUrlRef) => {
  // 表示ID経由は未存在もボードへのアクセス不可も null(短縮URLの画面と同じ経路)
  const ticketId = ref.kind === 'ticketId' ? ref.value : await findTicketIdByDisplayId(user, ref.value)
  if (!ticketId) {
    return null
  }

  // ボードに入れてもチケット単位で見えないことがあるので、ここでも確認する
  const access = await getTicketAccess(user, ticketId)
  if (!access?.canView) {
    return null
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      number: true,
      title: true,
      status: true,
      priority: true,
      dueDate: true,
      board: { select: { key: true } },
      assignee: { select: { name: true } },
    },
  })
  if (!ticket) {
    return null
  }

  // URL は小文字のキーやクエリ付きでも引けるので、表示は自前で組み直した正規形にする
  // (貼られた文字列をそのまま mrkdwn のリンクに埋めると `>` などで表示が崩れる)
  const canonicalId = ticketDisplayId({ key: ticket.board.key, number: ticket.number })

  const { locale } = user
  return {
    blocks: buildTicketUnfurlBlocks({
      url: makeUrl(ticketShortPath(canonicalId)).toString(),
      displayId: canonicalId,
      title: ticket.title,
      fields: [
        { label: t(locale, 'status'), value: t(locale, TICKET_STATUS_LOCALE[ticket.status]) },
        { label: t(locale, 'priority'), value: t(locale, TICKET_PRIORITY_LOCALE[ticket.priority]) },
        { label: t(locale, 'assignee'), value: ticket.assignee?.name ?? '' },
        // 期限は日付のみの値(UTC 0:00 保存)なので 'date' 書式で出す
        { label: t(locale, 'due_date'), value: dayformat(ticket.dueDate, 'date') },
      ],
    }),
  }
}

/**
 * `link_shared` を受けてプレビューを返す。
 *
 * Slack は 3 秒以内の応答を要求するため、route handler は 200 を返したあと
 * `after()` の中からこれを呼ぶこと。
 */
/**
 * 展開先を決める。`unfurl_id` + `source` は投稿済みでも入力中でも付くのでこちらを優先する。
 *
 * フォールバックの channel + message_ts は、入力中のイベントでは channel が `COMPOSER` という
 * 実在しない値になるため使えない。
 */
const resolveTarget = ({
  channel,
  message_ts: ts,
  unfurl_id: unfurlId,
  source,
}: SlackLinkSharedEvent): SlackUnfurlTarget | null => {
  if (unfurlId && source) {
    return { unfurlId, source }
  }
  if (channel && channel !== COMPOSER_CHANNEL && ts) {
    return { channel, ts }
  }
  return null
}

export const handleSlackLinkShared = async (event: SlackLinkSharedEvent): Promise<void> => {
  const { user: slackUserId, channel, is_bot_user_member: isBotMember, links } = event

  /**
   * 展開しない判断はどれも正常系なので、原因が追えるよう理由を残して抜ける。
   * `LOG_LEVEL=debug` の環境でだけ出す。
   */
  const skip = (reason: string, detail: Record<string, unknown> = {}) => {
    logger.debug({ reason, channel, ...detail }, 'slack unfurl skipped')
  }

  if (!slackUserId || !links?.length) {
    return skip('incomplete event', { hasUser: !!slackUserId, linkCount: links?.length ?? 0 })
  }

  const target = resolveTarget(event)
  if (!target) {
    return skip('no unfurl target', { hasUnfurlId: !!event.unfurl_id, source: event.source })
  }

  // Slack は Bot 未参加のチャンネルにもイベントを送る。呼んでも失敗するので手前で止める
  if (isBotMember === false) {
    return skip('bot is not in the channel')
  }

  const user = await resolveSharedBy(slackUserId)
  if (!user) {
    return skip('unlinked user', { slackUserId })
  }

  const baseUrl = envu.server.BETTER_AUTH_URL
  // 同じ URL を複数回貼られても照会は 1 度で済ませる
  const refByUrl = new Map<string, TicketUrlRef>()
  for (const { url } of links) {
    if (refByUrl.size >= MAX_UNFURL_LINKS) {
      break
    }
    if (!url || refByUrl.has(url)) {
      continue
    }
    const ref = parseTicketUrl(url, baseUrl)
    if (ref) {
      refByUrl.set(url, ref)
    }
  }
  if (refByUrl.size === 0) {
    // 自サイトのチケットURLが無い。オリジン違いで落ちていないか baseUrl も残す
    return skip('no ticket url', { baseUrl, urls: links.map(({ url }) => url) })
  }

  const unfurls: Record<string, { blocks: unknown[] }> = {}
  for (const [url, ref] of refByUrl) {
    const unfurl = await buildUnfurl(user, ref)
    if (unfurl) {
      unfurls[url] = unfurl
    }
  }

  // 展開できるものが 1 件も無ければ Slack を叩かない(URL のまま残す)
  if (Object.keys(unfurls).length === 0) {
    // 未存在と権限不足は区別しない(どのボードに何があるかを答えないため)
    return skip('no viewable ticket', { userId: user.id, refs: [...refByUrl.values()] })
  }

  logger.info({ userId: user.id, channel, count: Object.keys(unfurls).length }, 'slack unfurl')
  await unfurlSlackLinks(target, unfurls)
}
