/**
 * 実行ログの SSE ストリーム(サーバー専用)
 *
 * **DB が唯一の真実**で、ここは「カーソルより後ろを読んで流す」だけを繰り返す。
 * 実行しているプロセスを一切見ないので、
 * - 実行と配信が別プロセスでも動く
 * - 途中から接続 / 複数タブ / リロード後の再開 / 終了後の閲覧が**同じコードパス**になる
 * という性質がそのまま出る。
 *
 * 依存を引数で受けているのは、DB も時計も無しでフレームの組み立てをテストするため。
 */

import { type CommandRunStatus, type CommandStream } from '@/generated/prisma/enums'
import {
  COMMAND_SSE_HEARTBEAT_MS,
  COMMAND_SSE_MAX_MS,
  COMMAND_SSE_PAGE,
  COMMAND_SSE_POLL_MS,
  COMMAND_SSE_RETRY_MS,
  COMMAND_TERMINAL_STATUSES,
} from './command'
import { readLogChunks } from './command-log'
import { getCommandRun } from './command-run'
import { waitForRunSignal } from './command-signal'

const encoder = new TextEncoder()

export type LogChunk = { seq: number; stream: CommandStream; text: string }

export type RunState = {
  status: CommandRunStatus
  exitCode: number | null
  failureKind: string | null
  truncated: boolean
  lastSeq: number
}

export type LogStreamDeps = {
  readChunks: (runId: string, afterSeq: number, limit: number) => Promise<LogChunk[]>
  readState: (runId: string) => Promise<RunState | null>
  /** 合図・タイムアウト・切断のいずれか早い方まで待つ */
  wait: (runId: string, timeoutMs: number, signal: AbortSignal) => Promise<void>
  now: () => number
}

export const defaultLogStreamDeps: LogStreamDeps = {
  readChunks: (runId, afterSeq, limit) =>
    readLogChunks(runId, afterSeq, limit).then((chunks) =>
      chunks.map(({ seq, stream, text }) => ({ seq, stream, text })),
    ),
  readState: async (runId) => {
    const run = await getCommandRun(runId)
    if (!run) {
      return null
    }
    const { status, exitCode, failureKind, truncated, lastSeq } = run
    return { status, exitCode, failureKind, truncated, lastSeq }
  },
  wait: waitForRunSignal,
  now: () => Date.now(),
}

export const isTerminalStatus = (status: CommandRunStatus): boolean =>
  (COMMAND_TERMINAL_STATUSES as readonly string[]).includes(status)

/**
 * SSE の1フレーム。
 *
 * `data:` は改行を含められないので、本文は必ず `JSON.stringify` した1行にする。
 * `id:` を付けた行はブラウザが記憶し、再接続時に `Last-Event-ID` として送り返してくる。
 */
const frame = (event: string, data: unknown, id?: number): Uint8Array =>
  encoder.encode(`${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

/** コメント行。ハートビートと接続直後の1バイト送出に使う */
const comment = (text: string): Uint8Array => encoder.encode(`: ${text}\n\n`)

/**
 * ログを流す `ReadableStream`。
 *
 * `pull` は enqueue した分が捌けてから呼ばれるので、遅いクライアントは自然に待たされる
 * (サーバー側にバッファが積み上がらない)。
 */
export const buildLogStream = (
  runId: string,
  fromSeq: number,
  signal: AbortSignal,
  deps: LogStreamDeps = defaultLogStreamDeps,
): ReadableStream<Uint8Array> => {
  let cursor = fromSeq
  let closed = false
  let lastWriteAt = deps.now()
  const openedAt = deps.now()

  /** close 後の enqueue は例外になるので、必ずここを通す */
  const send = (controller: ReadableStreamDefaultController<Uint8Array>, chunk: Uint8Array) => {
    if (closed) {
      return
    }
    controller.enqueue(chunk)
    lastWriteAt = deps.now()
  }

  const finish = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (closed) {
      return
    }
    closed = true
    controller.close()
  }

  return new ReadableStream<Uint8Array>({
    start: (controller) => {
      /**
       * Next はヘッダを「最初のチャンクを書いた時」に flush する。
       * 接続直後に1フレーム流さないと `EventSource` の onopen が発火しない。
       */
      send(controller, encoder.encode(`retry: ${COMMAND_SSE_RETRY_MS}\n\n`))
      send(controller, comment('open'))
    },

    /**
     * **何かを enqueue するか閉じるまで戻らない。**
     *
     * enqueue せずに戻ると配信が止まる。Streams の仕様では `pull` の再呼び出しは
     * 「pull の実行中に新しい read 要求が来た」か「desiredSize > 0」のときだけで、
     * 消費側の read 要求は充足されないまま1つ残るだけなので新しい要求が発生しない。
     * 実際、出力の無いコマンドでは 2 回目の pull を最後に更新が止まった。
     */
    pull: async (controller) => {
      while (!closed) {
        if (signal.aborted) {
          finish(controller)
          return
        }

        const chunks = await deps.readChunks(runId, cursor, COMMAND_SSE_PAGE)
        if (chunks.length > 0) {
          chunks.forEach((chunk) => {
            send(controller, frame('log', { stream: chunk.stream, text: chunk.text }, chunk.seq))
            cursor = chunk.seq
          })
          return
        }

        const state = await deps.readState(runId)
        // 実行が消えた(履歴の掃除と競合)場合も開いたままにしない
        if (!state) {
          send(controller, frame('end', { status: 'gone' }))
          finish(controller)
          return
        }
        if (isTerminalStatus(state.status) && cursor >= state.lastSeq) {
          send(controller, frame('end', state))
          finish(controller)
          return
        }

        /**
         * 開きっぱなしの接続は張り直させる。`end` ではなく閉じるだけにして、
         * クライアントの自動再接続(`Last-Event-ID` 付き)に続きを任せる。
         */
        if (deps.now() - openedAt > COMMAND_SSE_MAX_MS) {
          send(controller, frame('reconnect', { cursor }))
          finish(controller)
          return
        }

        await deps.wait(runId, COMMAND_SSE_POLL_MS, signal)

        // 無音が続くと proxy にアイドル切断されるので定期的に1行流す
        if (!signal.aborted && deps.now() - lastWriteAt >= COMMAND_SSE_HEARTBEAT_MS) {
          send(controller, comment('hb'))
          return
        }
      }
    },

    cancel: () => {
      closed = true
    },
  })
}
