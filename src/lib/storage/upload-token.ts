/**
 * 画像アップロード用の短命トークン(サーバー専用)
 *
 * MCPクライアントは自分の Bearer(エージェントトークン / OAuthアクセストークン)をモデルへ渡さないため、
 * `/api/upload` へ直接POSTさせるにはその場限りの資格情報が要る。長期トークンをそのまま使わせると
 * 全権限の資格情報がエージェントのトランスクリプトに残ってしまうので、用途と寿命を絞った別物にする。
 *
 * トークン自体はステートレスなMCPと揃えてHS256の自己完結したJWTにする。`aud` を `/api/upload` に
 * 固定してあるため、このトークンで `/api/mcp` は通らず、逆にOAuthのアクセストークン(RS256)も
 * ここを通らない。使い捨ての保証だけは推測や近似では成り立たないので、使用済みの jti を
 * `UploadNonce` に記録して一意制約で担保する。
 */

import { jwtVerify, SignJWT } from 'jose'
import { uuidv7 } from 'uuidv7'
import { getBoardAccess } from '../board/board'
import { nowDate, withinMinutes } from '../day'
import { envu } from '../env-util'
import { logger } from '../logger'
import { parseBearerToken } from '../oauth/oauth-resource'
import { isUniqueViolation, prisma } from '../prisma'
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

/** 期限切れ行を掃除する間隔。記録のたびに DELETE を打たないためのしきい値 */
const NONCE_SWEEP_MINUTES = 10

let lastSweptAt: Date | null = null

/** 期限切れの nonce を消す。掃除の失敗でアップロードまで落とさない */
const sweepExpiredNonces = async () => {
  const now = nowDate()
  if (lastSweptAt && withinMinutes(lastSweptAt, NONCE_SWEEP_MINUTES)) {
    return
  }
  lastSweptAt = now
  await prisma.uploadNonce
    .deleteMany({ where: { expiresAt: { lt: now } } })
    .catch((error: unknown) => logger.warn({ error }, 'upload nonce sweep failed'))
}

/**
 * jti を使用済みとして記録する。2回目の INSERT は一意制約で必ず失敗するので、これが使い捨ての保証になる。
 * 記録できなければ理由を問わず false を返す(fail-closed)。
 */
const consumeUploadNonce = async (jti: string, expiresAt: Date): Promise<boolean> => {
  try {
    await prisma.uploadNonce.create({ data: { jti, expiresAt } })
  } catch (err) {
    if (isUniqueViolation(err)) {
      logger.info({ jti }, 'upload token replayed')
    } else {
      logger.warn({ err, jti }, 'upload nonce record failed')
    }
    return false
  }
  await sweepExpiredNonces()
  return true
}

export type UploadActor = { userId: string; boardId: string | null }

/**
 * 短命トークンを検証し、アップロードの実行者と添付先ボードを返す。
 *
 * トークンが主張する `boardId` は信用せず、利用時点でBAN・ボードの所属とアーカイブを引き直す
 * (発行後にBANされた/ボードから外れた/ボードがアーカイブされたケースを塞ぐ)。
 */
export const verifyUploadToken = async (token: string): Promise<UploadActor | null> => {
  let payload
  try {
    payload = (await jwtVerify(token, secret(), { issuer: issuer(), audience: audience(), algorithms: [ALGORITHM] }))
      .payload
  } catch {
    return null
  }

  const { sub, jti, exp, boardId } = payload
  if (!sub || !jti || typeof boardId !== 'string') {
    return null
  }

  // 後段で弾かれてもトークンは使い切る。使い捨ての意味論としてはそれでよい
  if (!(await consumeUploadNonce(jti, exp ? new Date(exp * 1000) : nowDate()))) {
    return null
  }

  const user = await prisma.user.findUnique({ where: { id: sub }, select: { id: true, role: true, banned: true } })
  if (!user || user.banned) {
    return null
  }
  // アーカイブ済みボードは本文の編集自体が禁止されるので、添付だけ増やせないようにする
  const access = await getBoardAccess(user, boardId)
  if (!access || access.archived) {
    logger.info({ userId: user.id, boardId }, 'upload token board unavailable')
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
