/**
 * 期限切れ行の掃除(サーバー専用)
 *
 * 消す条件はすべて、書き手が「もう使わない」と記録した列に紐づける
 * (`expiresAt` / `revoked` / `rotationReplayExpiresAt`)。
 * 推測で消さないので、掃除が動いていない環境と動いている環境で挙動が変わらない。
 *
 * 手順は逐次に実行する。どれもDBへの書き込みで、並行させるとコネクションを余分に掴むだけになる。
 */

import { type CommandRunStatus } from '@/generated/prisma/enums'
import { DAY_MS, msBefore, nowDate } from '../day'
import { envu } from '../env-util'
import { logger } from '../logger'
import { prisma } from '../prisma'
import {
  MAINTENANCE_DELETE_BATCH,
  OAUTH_TOKEN_RETENTION_MS,
  SESSION_RETENTION_MS,
  VERIFICATION_RETENTION_MS,
} from './maintenance'
import { sweepOrphanAttachments } from './maintenance-attachment'

/** 手順ごとの削除件数。失敗した手順は `-1` */
export type SweepCounts = Record<string, number>

/**
 * 期限切れのログインセッション。
 *
 * NOTE: `OauthAccessToken.sessionId` / `OauthRefreshToken.sessionId` は SetNull なので、
 * ここで消してもMCPのトークンは失効しない(Webの5日とMCPの180日は独立している)。
 */
export const sweepSessions = async (now: Date): Promise<number> =>
  (await prisma.session.deleteMany({ where: { expiresAt: { lt: msBefore(now, SESSION_RETENTION_MS) } } })).count

/**
 * 使われないまま期限が切れた検証値(メールOTPなど)。
 *
 * better-auth は使った行を消すが、送っただけで使われなかった行は残り続ける。
 * `expiresAt` だけで判断するので、ライブラリが用途を増やしても
 * 「ライブラリ自身が期限切れとみなした行」しか消さない。
 */
export const sweepVerifications = async (now: Date): Promise<number> =>
  (
    await prisma.verification.deleteMany({
      where: { expiresAt: { lt: msBefore(now, VERIFICATION_RETENTION_MS) } },
    })
  ).count

/**
 * 期限切れ・失効済みのリフレッシュトークン。**アクセストークンより先に消す。**
 *
 * `OauthAccessToken.refreshId` が Cascade なので、生きたアクセストークンを持つ行を消すと
 * 有効なトークンまで道連れになる。`oauthaccesstokens: { none: ... }` がその歯止め。
 * ローテーション済みトークンの再提示を検出する期間(`rotationReplayExpiresAt`)も待つ。
 */
export const sweepOauthRefreshTokens = async (now: Date): Promise<number> => {
  const before = msBefore(now, OAUTH_TOKEN_RETENTION_MS)
  const { count } = await prisma.oauthRefreshToken.deleteMany({
    where: {
      AND: [
        { OR: [{ expiresAt: { lt: before } }, { revoked: { lt: before } }] },
        { OR: [{ rotationReplayExpiresAt: null }, { rotationReplayExpiresAt: { lt: now } }] },
      ],
      oauthaccesstokens: { none: { expiresAt: { gte: now }, revoked: null } },
    },
  })
  return count
}

/** 期限切れ・失効済みのアクセストークン(リフレッシュトークンの Cascade で消えた分は含まない) */
export const sweepOauthAccessTokens = async (now: Date): Promise<number> => {
  const before = msBefore(now, OAUTH_TOKEN_RETENTION_MS)
  const { count } = await prisma.oauthAccessToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: before } }, { revoked: { lt: before } }] },
  })
  return count
}

/**
 * 期限切れのクライアントアサーション記録。
 * リプレイ防止という役目が `expiresAt` で終わるので猶予は要らない。
 */
export const sweepOauthClientAssertions = async (now: Date): Promise<number> =>
  (await prisma.oauthClientAssertion.deleteMany({ where: { expiresAt: { lt: now } } })).count

/**
 * 期限切れのアップロード用 nonce。
 *
 * `upload-token.ts` がアップロードのたびに掃除しているが、アップロードが無い期間は動かない。
 * ここはその取りこぼしを拾うだけなので、通常は0件になる。
 */
export const sweepUploadNonces = async (now: Date): Promise<number> =>
  (await prisma.uploadNonce.deleteMany({ where: { expiresAt: { lt: now } } })).count

/**
 * エージェントの実行履歴。保持期間(`AGENT_RUN_RETENTION_DAYS`)とランナーごとの件数
 * (`AGENT_RUN_KEEP`)の2本で抑える。
 *
 * `running` は時間切れの回収(`agent-run.ts` の `failStaleAgentRuns`)が持ち主なので触らない。
 */
export const sweepAgentRuns = async (now: Date): Promise<number> => {
  const keep = envu.server.AGENT_RUN_KEEP

  const { count } = await prisma.agentRun.deleteMany({
    where: {
      startedAt: { lt: msBefore(now, envu.server.AGENT_RUN_RETENTION_DAYS * DAY_MS) },
      status: { not: 'running' },
    },
  })

  let capped = 0
  const runners = await prisma.agentRunner.findMany({ select: { id: true } })
  for (const { id } of runners) {
    const excess = await prisma.agentRun.findMany({
      where: { runnerId: id, status: { not: 'running' } },
      select: { id: true },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      skip: keep,
      take: MAINTENANCE_DELETE_BATCH,
    })
    if (excess.length > 0) {
      capped += (await prisma.agentRun.deleteMany({ where: { id: { in: excess.map(({ id }) => id) } } })).count
    }
  }

  return count + capped
}

/**
 * コマンドの実行履歴。保持期間(`COMMAND_RUN_RETENTION_DAYS`)とコマンドごとの件数
 * (`COMMAND_RUN_KEEP`)の2本で抑える。
 *
 * ログ(`command_run_chunk`)は Cascade で一緒に消える。
 * `queued` / `running` は実行側(`command-run.ts` の `finishCommandRun` / `reclaimStaleRuns`)が
 * 持ち主なので触らない。掃除が先に消すと、実行中のワーカーが書き込み先を失う。
 */
export const sweepCommandRuns = async (now: Date): Promise<number> => {
  // 終了済みだけを対象にする。queued / running は実行側が持ち主
  const settled = { status: { in: ['succeeded', 'failed', 'canceled'] as CommandRunStatus[] } }
  const keep = envu.server.COMMAND_RUN_KEEP

  const { count } = await prisma.commandRun.deleteMany({
    where: { queuedAt: { lt: msBefore(now, envu.server.COMMAND_RUN_RETENTION_DAYS * DAY_MS) }, ...settled },
  })

  let capped = 0
  // 定義ファイルから消えたコマンドの履歴も対象にしたいので、実在するキーを履歴側から引く
  const keys = await prisma.commandRun.findMany({
    distinct: ['commandKey'],
    select: { commandKey: true },
  })
  for (const { commandKey } of keys) {
    const excess = await prisma.commandRun.findMany({
      where: { commandKey, ...settled },
      select: { id: true },
      orderBy: [{ queuedAt: 'desc' }, { id: 'desc' }],
      skip: keep,
      take: MAINTENANCE_DELETE_BATCH,
    })
    if (excess.length > 0) {
      capped += (await prisma.commandRun.deleteMany({ where: { id: { in: excess.map(({ id }) => id) } } })).count
    }
  }

  return count + capped
}

/** 1手順ぶん。1つ失敗しても残りの手順は続ける */
const runStep = async (counts: SweepCounts, step: string, fn: () => Promise<number>): Promise<void> => {
  try {
    counts[step] = await fn()
  } catch (error) {
    counts[step] = -1
    logger.error({ error, step }, 'maintenance step failed')
  }
}

/** 掃除を1周する */
export const runMaintenanceSweep = async (now: Date = nowDate()): Promise<SweepCounts> => {
  const counts: SweepCounts = {}

  await runStep(counts, 'session', () => sweepSessions(now))
  await runStep(counts, 'verification', () => sweepVerifications(now))
  // リフレッシュ → アクセスの順は Cascade の都合。入れ替えない
  await runStep(counts, 'oauthRefreshToken', () => sweepOauthRefreshTokens(now))
  await runStep(counts, 'oauthAccessToken', () => sweepOauthAccessTokens(now))
  await runStep(counts, 'oauthClientAssertion', () => sweepOauthClientAssertions(now))
  await runStep(counts, 'uploadNonce', () => sweepUploadNonces(now))
  await runStep(counts, 'agentRun', () => sweepAgentRuns(now))
  await runStep(counts, 'commandRun', () => sweepCommandRuns(now))
  await runStep(counts, 'attachment', () => sweepOrphanAttachments(now))

  logger.info(counts, 'maintenance sweep finished')
  return counts
}
