/**
 * トランザクション単位の advisory lock(サーバー専用)
 *
 * better-auth の API は Prisma のトランザクションとは別の接続で書き込むため、`$transaction` で
 * 囲んでも「件数を判定してから作成/削除する」間に他のリクエストが割り込める。
 * `pg_advisory_xact_lock` はトランザクションが終わるまで保持されるので、同じキーの処理を
 * すべてこの関数経由にすれば、中で別接続の書き込みを挟んでも処理全体を直列化できる。
 *
 * 別接続の書き込みはロックの解放より先にコミットされるので、後続は READ COMMITTED の
 * 読み取りでその結果を見てから判定できる。
 */

import type { Prisma } from '@/generated/prisma/client'
import { prisma } from './prisma'

/** ロックのキー。同じ資源を守る処理は必ず同じキーを使う */
export const ADVISORY_LOCK_KEYS = {
  /** 初回セットアップ(最初の管理者の作成) */
  initialSetup: 'initial-setup',
  /** 管理者の削除・降格(最後の管理者を残す判定) */
  adminRole: 'admin-role',
} as const
type AdvisoryLockKey = (typeof ADVISORY_LOCK_KEYS)[keyof typeof ADVISORY_LOCK_KEYS]

/** 中で better-auth のパスワードハッシュ計算などを挟むため、既定(5秒)より長く取る */
const LOCK_TX_TIMEOUT_MS = 30_000
const LOCK_TX_MAX_WAIT_MS = 10_000

export const withAdvisoryLock = async <T>(
  key: AdvisoryLockKey,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> =>
  prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`
      return fn(tx)
    },
    { timeout: LOCK_TX_TIMEOUT_MS, maxWait: LOCK_TX_MAX_WAIT_MS },
  )
