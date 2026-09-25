/**
 * 利用者本人が許可した OAuth クライアント(同意)の一覧と取り消し(サーバー専用)
 */

import { headers } from 'next/headers'
import { auth } from '../auth/auth'
import { nowDate } from '../day'
import { errNotFound } from '../error'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { dedupeScopes } from './oauth-consent'

export const listUserOAuthConsents = async (userId: string) => {
  // auth.api.getOAuthConsents はクライアント名を返さないので、リレーションを辿れる Prisma で1クエリにする
  const consents = await prisma.oauthConsent.findMany({
    where: { userId },
    select: {
      id: true,
      scopes: true,
      updatedAt: true,
      oauthclient: { select: { clientId: true, name: true } },
    },
  })
  return consents.map(({ id, scopes, updatedAt, oauthclient }) => ({
    id,
    clientId: oauthclient.clientId,
    clientName: oauthclient.name ?? '',
    scopes: dedupeScopes(scopes),
    updatedAt,
  }))
}

/**
 * 許可済みアプリの取り消し。
 * 同意行を消すだけでは発行済みのアクセス/リフレッシュトークンは有効なままなので、
 * 対象クライアント宛のトークンも失効させて「取り消し」と実際の権限を一致させる。
 *
 * トークンの失効を先に済ませてから同意行を消す。途中で落ちた場合に
 * 「同意は消えたのにトークンは有効」という権限が残る側の中間状態を作らないため。
 */
export const revokeUserOAuthConsent = async (userId: string, id: string) => {
  const consent = await prisma.oauthConsent.findUnique({ where: { id }, select: { userId: true, clientId: true } })
  if (!consent || consent.userId !== userId) {
    throw errNotFound()
  }

  const revoked = nowDate()
  const where = { userId, clientId: consent.clientId, revoked: null }
  const [accessTokens, refreshTokens] = await prisma.$transaction([
    prisma.oauthAccessToken.updateMany({ where, data: { revoked } }),
    prisma.oauthRefreshToken.updateMany({ where, data: { revoked } }),
  ])

  await auth.api.deleteOAuthConsent({ headers: await headers(), body: { id } })

  logger.info(
    { userId, clientId: consent.clientId, accessTokens: accessTokens.count, refreshTokens: refreshTokens.count },
    'oauth consent revoked',
  )
}
