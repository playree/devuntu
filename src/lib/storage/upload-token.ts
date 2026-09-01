/**
 * 画像アップロード用の短命トークン(サーバー専用)
 *
 * MCPクライアントは自分の Bearer(エージェントトークン / OAuthアクセストークン)をモデルへ渡さないため、
 * `/api/upload` へ直接POSTさせるにはその場限りの資格情報が要る。長期トークンをそのまま使わせると
 * 全権限の資格情報がエージェントのトランスクリプトに残ってしまうので、用途と寿命を絞った別物にする。
 *
 * ステートレスなMCPと揃えてDBは増やさず、HS256の自己完結したJWTにする。`aud` を `/api/upload` に
 * 固定してあるため、このトークンで `/api/mcp` は通らず、逆にOAuthのアクセストークン(RS256)も
 * ここを通らない。
 */

import { jwtVerify, SignJWT } from 'jose'
import { uuidv7 } from 'uuidv7'
import { getBoardAccess } from '../board/board'
import { envu } from '../env-util'
import { logger } from '../logger'
import { parseBearerToken } from '../oauth/oauth-resource'
import { prisma } from '../prisma'
import { consumeRateLimit } from '../rate-limit'
import { makeUrl } from '../server-utils'
import { UPLOAD_URL_PREFIX } from './upload'

/**
 * 有効期限。モデルがcurlを組み立てて実行するまでのラグを見込みつつ、
 * トランスクリプトへ残ったトークンが使える窓を短く保つ。
 */
export const UPLOAD_TOKEN_TTL_SECONDS = 10 * 60

const ALGORITHM = 'HS256'

/** 環境変数の必須チェックがビルド時に走らないよう、利用時まで評価を遅らせる */
const secret = () => new TextEncoder().encode(envu.server.BETTER_AUTH_SECRET)
const issuer = () => envu.server.BETTER_AUTH_URL
const audience = () => makeUrl(UPLOAD_URL_PREFIX).toString()

/** 戻り値の平文は発行時にしか取得できない(保存もしない) */
export const signUploadToken = async ({ userId, boardId }: { userId: string; boardId: string }): Promise<string> =>
  new SignJWT({ boardId })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(userId)
    .setIssuer(issuer())
    .setAudience(audience())
    .setJti(uuidv7())
    .setIssuedAt()
    .setExpirationTime(`${UPLOAD_TOKEN_TTL_SECONDS}s`)
    .sign(secret())

export type UploadActor = { userId: string; boardId: string | null }

/**
 * 短命トークンを検証し、アップロードの実行者と添付先ボードを返す。
 *
 * トークンが主張する `boardId` は信用せず、利用時点でBAN・ボードの所属を引き直す
 * (発行後にBANされた/ボードから外れたケースを塞ぐ)。
 */
export const verifyUploadToken = async (token: string): Promise<UploadActor | null> => {
  let payload
  try {
    payload = (await jwtVerify(token, secret(), { issuer: issuer(), audience: audience(), algorithms: [ALGORITHM] }))
      .payload
  } catch {
    return null
  }

  const { sub, jti, boardId } = payload
  if (!sub || !jti || typeof boardId !== 'string') {
    return null
  }

  /**
   * 1回きりの近似。カウンタはプロセス内メモリなので、水平スケール時や再起動後は
   * 有効期限まで再利用できてしまう(fail-open)。厳密な使い捨てが要る場合はDBへ移すこと。
   */
  if (!consumeRateLimit(`upload-token:${jti}`, { limit: 1, windowMs: UPLOAD_TOKEN_TTL_SECONDS * 1000 })) {
    logger.info({ jti }, 'upload token replayed')
    return null
  }

  const user = await prisma.user.findUnique({ where: { id: sub }, select: { id: true, role: true, banned: true } })
  if (!user || user.banned) {
    return null
  }
  if (!(await getBoardAccess(user, boardId))) {
    logger.info({ userId: user.id, boardId }, 'upload token board access lost')
    return null
  }

  return { userId: user.id, boardId }
}

export type UploadAuthResult = { ok: true; actor: UploadActor } | { ok: false }

/** リクエストに Bearer があれば短命トークンとして扱う。無ければセッション経路にフォールバックさせる */
export const resolveUploadToken = async (req: Request): Promise<UploadAuthResult | null> => {
  const token = parseBearerToken(req.headers.get('authorization'))
  if (!token) {
    return null
  }
  const actor = await verifyUploadToken(token)
  return actor ? { ok: true, actor } : { ok: false }
}
