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
 *
 * ロックの保持者は、トランザクションの接続に加えて better-auth の書き込み用にもう1本、同じ
 * プールから接続を取る。ロック待ちがそれぞれ接続を握ったままだとプールを使い切り、保持者が
 * 接続を取れずタイムアウトまで止まる。そこで DB のロックを取りに行く前にプロセス内でも
 * キーごとに順番待ちさせ、1プロセスがロック待ちで握る接続を常に1本に抑える
 * (複数プロセス間の排他は DB のロックが受け持つ)。
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

/** キーごとのプロセス内の待ち行列。末尾の処理が終わる(成否は問わない)と解決する */
const localQueues = new Map<AdvisoryLockKey, Promise<unknown>>()

export const withAdvisoryLock = async <T>(
  key: AdvisoryLockKey,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> => {
  const previous = localQueues.get(key) ?? Promise.resolve()
  const run = previous.then(() =>
    prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`
        return fn(tx)
      },
      { timeout: LOCK_TX_TIMEOUT_MS, maxWait: LOCK_TX_MAX_WAIT_MS },
    ),
  )
  // 失敗しても後続は進める。例外は呼び出し元へ返す run の側が受け取る
  const settled = run.then(
    () => {},
    () => {},
  )
  localQueues.set(key, settled)
  try {
    return await run
  } finally {
    // 後ろに誰も並んでいなければ片付ける(キーは固定なので残しても増えないが、参照を切る)
    if (localQueues.get(key) === settled) {
      localQueues.delete(key)
    }
  }
}
