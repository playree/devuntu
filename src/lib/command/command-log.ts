/**
 * 実行ログの蓄積と保存(サーバー専用)
 *
 * 出力を1行ずつ INSERT すると冗長なコマンドで数千回の往復になり、書き込みが実行を律速する。
 * 一定間隔(`COMMAND_FLUSH_INTERVAL_MS`)またはサイズ(`COMMAND_FLUSH_BYTES`)でまとめて書く。
 *
 * 保存した行は SSE の配信元でもあり履歴の本体でもある。実行プロセスと配信を直接つながず
 * DB を唯一の真実にしているので、購読者がいてもいなくても書き込みの挙動は変わらない。
 */

import { type CommandStream } from '@/generated/prisma/enums'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { COMMAND_FLUSH_BYTES, COMMAND_MAX_CHUNKS, COMMAND_MAX_OUTPUT_BYTES, COMMAND_RUNAWAY_BYTES } from './command'

/**
 * PostgreSQL の text は NUL を格納できない。孤立サロゲートも UTF-8 として不正なので落とす。
 *
 * バイナリを吐くコマンドで実行ごと失敗させないための処理で、表示のための整形はしない。
 */
export const sanitizeLogText = (text: string): string =>
  text
    .replaceAll('\u0000', '')
    // 孤立サロゲート(対になっていない上位/下位)は UTF-8 として不正なので置換文字へ倒す
    .replaceAll(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD')

export type LogChunkInput = { stream: CommandStream; text: string }

export type LogBuffer = {
  /** 出力を積む。上限に達していれば捨てるだけで、実行は止めない */
  push: (stream: CommandStream, text: string) => void
  /**
   * 溜まった分を書き出す。
   *
   * 所有権(status=running かつ自分が掴んだ行)を失っていたら false を返す。
   * stale 回収が先に実行を閉じた場合で、呼び出し元はそこで打ち切る。
   */
  flush: () => Promise<boolean>
  /** 保存を打ち切ったか */
  truncated: () => boolean
  /** 保存したバイト数 */
  bytes: () => number
  /** 受け取った総バイト数(捨てた分も含む)。暴走の判定に使う */
  received: () => number
  /** 未書き出しの分があるか */
  pending: () => boolean
  /** サイズ閾値に達したか。間隔を待たずに書き出すかの判定 */
  shouldFlush: () => boolean
}

/** 出力が暴走とみなす量に達したか */
export const isRunaway = (receivedBytes: number): boolean => receivedBytes > COMMAND_RUNAWAY_BYTES

export const createLogBuffer = (runId: string, workerId: string): LogBuffer => {
  let queue: LogChunkInput[] = []
  let queuedBytes = 0
  let savedBytes = 0
  let receivedBytes = 0
  let savedChunks = 0
  let isTruncated = false
  /** 打ち切りの説明を1度だけ入れるためのフラグ */
  let truncationNoticeQueued = false

  const enqueue = (stream: CommandStream, text: string) => {
    queue.push({ stream, text })
    queuedBytes += Buffer.byteLength(text, 'utf8')
  }

  const push: LogBuffer['push'] = (stream, raw) => {
    const text = sanitizeLogText(raw)
    if (text.length === 0) {
      return
    }
    receivedBytes += Buffer.byteLength(text, 'utf8')

    if (isTruncated) {
      return
    }

    if (savedBytes + queuedBytes >= COMMAND_MAX_OUTPUT_BYTES || savedChunks + queue.length >= COMMAND_MAX_CHUNKS) {
      isTruncated = true
      if (!truncationNoticeQueued) {
        truncationNoticeQueued = true
        // 「途中で切れている」ことを履歴からも分かるようにする
        enqueue('system', '出力が上限に達したため、これ以降のログは保存していません。')
      }
      return
    }

    enqueue(stream, text)
  }

  const flush: LogBuffer['flush'] = async () => {
    if (queue.length === 0) {
      // 書くものが無くても生存申告は必要なので、所有権の確認だけは行う
      return touchRun(runId, workerId)
    }

    const batch = queue
    const batchBytes = queuedBytes
    queue = []
    queuedBytes = 0

    // seq は「保存済みの最大 + 1」から振る。欠番も逆転も作らないよう同一トランザクションで更新する
    const applied = await prisma.$transaction(async (tx) => {
      const updated = await tx.commandRun.updateMany({
        where: { id: runId, status: 'running', workerId },
        data: {
          lastSeq: { increment: batch.length },
          bytes: { increment: batchBytes },
          truncated: isTruncated,
          heartbeatAt: new Date(),
        },
      })
      if (updated.count === 0) {
        return false
      }
      const run = await tx.commandRun.findUniqueOrThrow({ where: { id: runId }, select: { lastSeq: true } })
      const firstSeq = run.lastSeq - batch.length + 1
      await tx.commandRunChunk.createMany({
        data: batch.map((chunk, index) => ({
          runId,
          seq: firstSeq + index,
          stream: chunk.stream,
          text: chunk.text,
        })),
      })
      return true
    })

    if (!applied) {
      logger.warn({ runId, workerId }, 'command run ownership lost while flushing')
      return false
    }

    savedBytes += batchBytes
    savedChunks += batch.length
    return true
  }

  return {
    push,
    flush,
    truncated: () => isTruncated,
    bytes: () => savedBytes,
    received: () => receivedBytes,
    pending: () => queue.length > 0,
    shouldFlush: () => queuedBytes >= COMMAND_FLUSH_BYTES,
  }
}

/**
 * 生存申告。所有権を失っていたら false。
 *
 * 書き出す内容が無いときの `flush()` もこれを呼ぶので、
 * ログを出さないコマンドでも running のまま回収されることはない。
 */
export const touchRun = async (runId: string, workerId: string): Promise<boolean> => {
  const updated = await prisma.commandRun.updateMany({
    where: { id: runId, status: 'running', workerId },
    data: { heartbeatAt: new Date() },
  })
  return updated.count > 0
}

/** SSE と履歴詳細が使う読み出し。カーソルより後ろを seq 順に引く */
export const readLogChunks = async (
  runId: string,
  afterSeq: number,
  limit: number,
): Promise<{ seq: number; stream: CommandStream; text: string; at: Date }[]> =>
  prisma.commandRunChunk.findMany({
    where: { runId, seq: { gt: afterSeq } },
    orderBy: { seq: 'asc' },
    take: limit,
    select: { seq: true, stream: true, text: true, at: true },
  })

/** アプリが差し込む1行(中断・回収などの説明)。実行が閉じた後でも書けるようにしておく */
export const appendSystemChunk = async (runId: string, text: string): Promise<void> => {
  try {
    await prisma.$transaction(async (tx) => {
      const run = await tx.commandRun.update({
        where: { id: runId },
        data: { lastSeq: { increment: 1 } },
        select: { lastSeq: true },
      })
      await tx.commandRunChunk.create({
        data: { runId, seq: run.lastSeq, stream: 'system', text: sanitizeLogText(text) },
      })
    })
  } catch (error) {
    // 説明が残せなくても実行の記録そのものは残る。ここで例外を上げて回収を止めない
    logger.warn({ error, runId }, 'failed to append system chunk')
  }
}
