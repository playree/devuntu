/**
 * Google カレンダー サーバー専用ユーティリティ
 *
 * prisma に依存するため、クライアントからは import しないこと。
 *
 * NOTE: `googleapis` は型が巨大で `next build` が OOM するため使用しない。
 *       token 更新・FreeBusy 取得は標準 `fetch` で REST を直接呼び出す。
 */

import { DEFAULT_TZ } from './day'
import { envu } from './env-util'
import { canUseGoogleAccount } from './google-account'
import { GOOGLE_ACCOUNT_PROVIDER_ID, type BusySlot } from './google-calendar'
import { logger } from './logger'
import { prisma } from './prisma'

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const FREEBUSY_ENDPOINT = 'https://www.googleapis.com/calendar/v3/freeBusy'

type FreeBusyResponse = {
  calendars?: Record<string, { busy?: { start?: string; end?: string }[] }>
}

/**
 * refresh token からアクセストークンを更新する。失敗時は null。
 */
const refreshAccessToken = async (clientId: string, clientSecret: string, refreshToken: string) => {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    logger.error({ status: res.status, body }, 'failed to refresh google access token')
    return null
  }
  const data = (await res.json()) as { access_token?: string }
  return data.access_token ?? null
}

/**
 * 指定ユーザーの primary カレンダーの FreeBusy(予定あり区間)を取得する。
 *
 * 公開ページ(セッションなし)からも呼べるよう、account に保存された refresh token から
 * アクセストークンを更新して呼び出す。
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
  const clientId = envu.server.GOOGLE_CLIENT_ID
  const clientSecret = envu.server.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    logger.warn('google client id/secret is not set')
    return null
  }

  // 所有者(カレンダー主)が連携を利用不可なら公開ページも表示ガード(データは保持)
  if (!(await canUseGoogleAccount(userId))) {
    return null
  }

  const account = await prisma.account.findFirst({
    where: { userId, providerId: GOOGLE_ACCOUNT_PROVIDER_ID },
    select: { refreshToken: true },
  })
  if (!account?.refreshToken) {
    // 未連携
    return null
  }

  try {
    const accessToken = await refreshAccessToken(clientId, clientSecret, account.refreshToken)
    if (!accessToken) {
      return null
    }

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
