/**
 * Google カレンダー サーバー専用ユーティリティ
 *
 * prisma に依存するため、クライアントからは import しないこと。
 *
 * NOTE: `googleapis` は型が巨大で `next build` が OOM するため使用しない。
 *       token 更新・FreeBusy 取得は標準 `fetch` で REST を直接呼び出す。
 */

import { auth } from '../auth'
import { DEFAULT_TZ } from '../day'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { canUseGoogleAccount, googleAccountQuery } from './google-account'
import type { BusySlot } from './google-calendar'

const FREEBUSY_ENDPOINT = 'https://www.googleapis.com/calendar/v3/freeBusy'

type FreeBusyResponse = {
  calendars?: Record<string, { busy?: { start?: string; end?: string }[] }>
}

/**
 * 指定ユーザーの primary カレンダーの FreeBusy(予定あり区間)を取得する。
 *
 * 公開ページ(セッションなし)からも呼べるよう、better-auth の getAccessToken で
 * account に保存された refresh token からアクセストークンを取得(必要なら自動更新)して呼び出す。
 *
 * 未連携・設定不足・API エラー時は null を返す(呼び出し側で「利用できません」を表示する想定)。
 */
export const getGoogleFreeBusy = async ({
  userId,
  timeMin,
  timeMax,
  timeZone = DEFAULT_TZ,
}: {
  userId: string
  timeMin: string
  timeMax: string
  timeZone?: string
}): Promise<BusySlot[] | null> => {
  // 所有者(カレンダー主)が連携を利用不可なら公開ページも表示ガード(データは保持)。
  // GOOGLE_CLIENT_ID/SECRET 未設定時もここで false になる。
  if (!(await canUseGoogleAccount(userId))) {
    return null
  }

  // getAccessToken は providerId ではなく account 行の id で対象を選ぶので先に引く
  const account = await prisma.account.findFirst({
    ...googleAccountQuery(userId),
    select: { id: true },
  })
  if (!account) {
    return null
  }

  // better-auth に委譲。headers を渡さず userId のみで呼ぶことで、
  // セッション無し(公開ページ)からのサーバー内部呼び出しとして解決される。
  let accessToken: string | null = null
  try {
    const res = await auth.api.getAccessToken({
      body: { accountId: account.id, userId },
    })
    accessToken = res.accessToken ?? null
  } catch (error) {
    // 未連携・refresh token 無し等は APIError が投げられる
    logger.warn({ error, userId }, 'failed to get google access token')
    return null
  }
  if (!accessToken) {
    return null
  }

  try {
    const res = await fetch(FREEBUSY_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        timeMin,
        timeMax,
        timeZone,
        items: [{ id: 'primary' }],
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      logger.error({ status: res.status, body, userId }, 'failed to fetch google freebusy')
      return null
    }

    const data = (await res.json()) as FreeBusyResponse
    const busy = data.calendars?.primary?.busy ?? []
    return busy
      .filter((slot): slot is { start: string; end: string } => !!slot.start && !!slot.end)
      .map(({ start, end }) => ({ start, end }))
  } catch (error) {
    logger.error({ error, userId }, 'failed to fetch google freebusy')
    return null
  }
}
