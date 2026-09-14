/**
 * 実行のライフサイクル(サーバー専用)
 *
 * 状態遷移はこのファイルだけが行う(`agent-runner.ts` が `Ticket.agentState` を1箇所に
 * 集約しているのと同じ理由。遷移が散ると「どこで閉じられたか」が追えなくなる)。
 *
 * 3つの経路で必ず閉じられるようにしてある。
 * 1. 実行本人(`finishCommandRun`)
 * 2. 中断要求(`applyCancelRequests`)
 * 3. 生存申告が途切れた行の回収(`reclaimStaleRuns`)
 *
 * 通知キューと違い**自動リトライはしない**。副作用のあるコマンドを勝手に再実行してはいけない。
 */

import { type CommandRunStatus } from '@/generated/prisma/enums'
import { nowDate } from '../day'
import { errClient } from '../error'
import { logger } from '../logger'
import { isUniqueViolation, prisma } from '../prisma'
import {
  COMMAND_ALREADY_RUNNING,
  COMMAND_QUEUE_FULL,
  COMMAND_STALE_MS,
  type CommandDef,
  type CommandFailureKind,
  type CommandInputValues,
  type CommandRunSortColumn,
  type CommandRunStatusValue,
} from './command'
import { appendSystemChunk } from './command-log'

export type ClaimedRun = {
  id: string
  commandKey: string
  params: unknown
  userId: string | null
}

/**
 * 実行を待ち行列へ入れる。
 *
 * 同じコマンドの多重実行は `activeKey` の一意制約で弾く。件数を数えて判断するより競合に強い
 * (数えた直後に別のリクエストが入る隙間が無い)。
 *
 * 一方で `maxQueued` は**ソフト上限**。数えてから INSERT するまでの隙間に別のリクエストが入ると
 * 同時投入ぶんだけ超えうる。実際に走る本数は `COMMAND_MAX_CONCURRENT` が別に抑えるため、
 * ここを直列化してまで厳密には守っていない。
 */
export const enqueueCommandRun = async (input: {
  def: CommandDef
  hostLabel: string
  actor: { id: string; name: string }
  params: CommandInputValues
  argsPreview: string
  maxQueued: number
}): Promise<{ id: string }> => {
  const { def, hostLabel, actor, params, argsPreview, maxQueued } = input

  const waiting = await prisma.commandRun.count({ where: { status: 'queued' } })
  if (waiting >= maxQueued) {
    throw errClient(COMMAND_QUEUE_FULL)
  }

  try {
    const run = await prisma.commandRun.create({
      data: {
        commandKey: def.id,
        commandLabel: def.label,
        hostLabel,
        userId: actor.id,
        userName: actor.name,
        params: params as object,
        argsPreview,
        // singleton でなければ null。null 同士は一意制約の対象外なので何本でも並行できる
        activeKey: def.singleton ? def.id : null,
      },
      select: { id: true },
    })
    logger.info({ runId: run.id, commandKey: def.id, userId: actor.id }, 'command run queued')
    return run
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw errClient(COMMAND_ALREADY_RUNNING)
    }
    throw error
  }
}

/**
 * 未処理の実行を投入順に掴む。
 *
 * `FOR UPDATE SKIP LOCKED` なので同じ行を2つのワーカーが掴むことはなく、
 * リーダー選出の仕組みが要らない(`notify-queue.ts` と同じ理由)。
 * 通知と違って `attempts` は持たない。掴んだまま落ちた行は再試行せず失敗として閉じる。
 */
export const claimQueuedRuns = (limit: number, workerId: string) =>
  prisma.$queryRaw<ClaimedRun[]>`
    UPDATE "command_run"
    SET "status" = 'running', "claimedAt" = NOW(), "heartbeatAt" = NOW(), "startedAt" = NOW(), "workerId" = ${workerId}
    WHERE "id" IN (
      SELECT "id" FROM "command_run"
      WHERE "status" = 'queued'
      ORDER BY "queuedAt", "id"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "commandKey", "params", "userId"
  `

/**
 * 実行を終了として確定する。
 *
 * `status = 'running'` かつ自分が掴んだ行、という条件付き更新にしてあるので、
 * 回収が先に閉じていた場合は何もしない(確定済みの結果を上書きしない)。
 * `activeKey` を null に戻すのはここだけ。戻し忘れると次の実行が永久に弾かれる。
 */
export const finishCommandRun = async (input: {
  runId: string
  workerId: string
  status: Extract<CommandRunStatus, 'succeeded' | 'failed' | 'canceled'>
  exitCode: number | null
  failureKind?: CommandFailureKind
}): Promise<boolean> => {
  const { runId, workerId, status, exitCode, failureKind } = input
  const updated = await prisma.commandRun.updateMany({
    where: { id: runId, status: 'running', workerId },
    data: {
      status,
      exitCode,
      failureKind: failureKind ?? null,
      finishedAt: nowDate(),
      activeKey: null,
      workerId: null,
    },
  })
  if (updated.count === 0) {
    return false
  }
  logger.info({ runId, status, exitCode, failureKind }, 'command run finished')
  return true
}

/**
 * 中断を要求する。
 *
 * `queued` はその場で確定できる(まだ SSH を張っていない)。`running` はフラグを立てるだけで、
 * 実際に止めるのは実行を掴んでいるワーカー。**別プロセスの子プロセスは kill できない**ので、
 * 合図は必ず DB を経由させる。
 */
export const requestCancelCommandRun = async (runId: string, actorId: string): Promise<CommandRunStatus | null> => {
  const now = nowDate()

  const canceled = await prisma.commandRun.updateMany({
    where: { id: runId, status: 'queued' },
    data: {
      status: 'canceled',
      failureKind: 'canceled',
      cancelRequestedAt: now,
      cancelRequestedBy: actorId,
      finishedAt: now,
      activeKey: null,
    },
  })
  if (canceled.count > 0) {
    await appendSystemChunk(runId, '順番待ちの間に中断されました。')
    return 'canceled'
  }

  const requested = await prisma.commandRun.updateMany({
    where: { id: runId, status: 'running', cancelRequestedAt: null },
    data: { cancelRequestedAt: now, cancelRequestedBy: actorId },
  })
  return requested.count > 0 ? 'running' : null
}

/** 中断が要求されている実行のID。ワーカーが自分の掴んだ分だけ拾う */
export const listCancelRequestedRuns = async (workerId: string): Promise<string[]> => {
  const runs = await prisma.commandRun.findMany({
    where: { status: 'running', workerId, cancelRequestedAt: { not: null } },
    select: { id: true },
  })
  return runs.map((run) => run.id)
}

/**
 * 生存申告が途切れた実行を失敗として閉じる。
 *
 * アプリの再起動やクラッシュで掴んだまま終わった行は、誰も面倒を見ないと running のまま残り、
 * `activeKey` が居座って同じコマンドを二度と実行できなくなる。
 *
 * **`queued` へは戻さない。** 副作用のあるコマンドを勝手に再実行してはいけないため、
 * 通知キューの `reclaimStale()`(未処理へ戻す)とは方針を変えている。
 */
export const reclaimStaleRuns = async (now: Date = nowDate()): Promise<number> => {
  const before = new Date(now.getTime() - COMMAND_STALE_MS)

  /**
   * 対象の特定と更新を1文にまとめる(`claimQueuedRuns` と同じ形)。
   *
   * 抽出と更新を分けると、その隙間に生存申告を入れた**動いている実行**まで
   * `interrupted` として閉じてしまう。
   */
  const reclaimed = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "command_run"
    SET "status" = 'failed', "failureKind" = 'interrupted', "finishedAt" = ${now},
        "activeKey" = NULL, "workerId" = NULL
    WHERE "status" = 'running' AND ("heartbeatAt" IS NULL OR "heartbeatAt" < ${before})
    RETURNING "id"
  `
  if (reclaimed.length === 0) {
    return 0
  }

  // 実際に閉じた行にだけ説明を残す
  await Promise.all(
    reclaimed.map(({ id }) =>
      appendSystemChunk(id, '実行していたプロセスが応答しなくなったため、失敗として記録しました。'),
    ),
  )
  logger.warn({ count: reclaimed.length }, 'command runs reclaimed')
  return reclaimed.length
}

/** 1件引く。SSE と履歴詳細が使う */
export const getCommandRun = async (runId: string) =>
  prisma.commandRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      commandKey: true,
      commandLabel: true,
      hostLabel: true,
      userId: true,
      userName: true,
      params: true,
      argsPreview: true,
      status: true,
      exitCode: true,
      failureKind: true,
      lastSeq: true,
      truncated: true,
      queuedAt: true,
      startedAt: true,
      finishedAt: true,
    },
  })

export type CommandRunDetail = NonNullable<Awaited<ReturnType<typeof getCommandRun>>>

/**
 * 実行履歴の一覧。
 *
 * 一般ユーザーは自分の実行だけを見る。`scope: 'all'` は呼び出し側で管理者を確かめてから渡す
 * (ここは絞り込みの組み立てに徹し、認可は持ち込まない)。
 */
export const listCommandRuns = async (input: {
  /** null なら絞り込みなし(管理者の全件表示) */
  userId: string | null
  status: CommandRunStatusValue[]
  page: number
  rowsPerPage: number
  sortColumn: CommandRunSortColumn
  sortDirection: 'ascending' | 'descending'
}) => {
  const { userId, status, page, rowsPerPage, sortColumn, sortDirection } = input
  const where = {
    ...(userId ? { userId } : {}),
    ...(status.length > 0 ? { status: { in: status } } : {}),
  }

  const [items, total] = await Promise.all([
    prisma.commandRun.findMany({
      where,
      select: {
        id: true,
        commandKey: true,
        commandLabel: true,
        hostLabel: true,
        userName: true,
        argsPreview: true,
        status: true,
        exitCode: true,
        failureKind: true,
        queuedAt: true,
        finishedAt: true,
      },
      // 同値の行が page をまたいで重複・欠落しないよう、必ず id で決着させる
      orderBy: [{ [sortColumn]: sortDirection === 'ascending' ? 'asc' : 'desc' }, { id: 'desc' }],
      skip: (page - 1) * rowsPerPage,
      take: rowsPerPage,
    }),
    prisma.commandRun.count({ where }),
  ])

  return { items, total }
}

export type CommandRunListItem = Awaited<ReturnType<typeof listCommandRuns>>['items'][number]

/** 実行中の件数。同時実行数の枠を数えるのに使う */
export const countRunningRuns = async (): Promise<number> => prisma.commandRun.count({ where: { status: 'running' } })
