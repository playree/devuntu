/**
 * 1実行ぶんの進行(サーバー専用)
 *
 * spawn → 出力の取り込み → 上限 / タイムアウト / 中断の監視 → 終了の記録 までを受け持つ。
 * SSH そのものは `command-ssh.ts` の `SshProcess` 越しにしか触らないので、
 * テストではそこだけを差し替えれば実際に接続しなくても全経路を通せる。
 */

import { StringDecoder } from 'node:string_decoder'
import { logger } from '../logger'
import {
  COMMAND_ABORT_GRACE_MS,
  COMMAND_FLUSH_INTERVAL_MS,
  COMMAND_FLUSH_MAX_RETRIES,
  COMMAND_KILL_GRACE_MS,
  type CommandDef,
  type CommandFailureKind,
  type CommandHost,
  type CommandInputValues,
} from './command'
import { buildRemoteCommand, isSentinelLine, resolveCommandArgs } from './command-args'
import { appendSystemChunk, createLogBuffer, isRunaway, type LogBuffer } from './command-log'
import { abortRun, registerRun, unregisterRun } from './command-registry'
import { finishCommandRun } from './command-run'
import { signalRun } from './command-signal'
import { resolveSshTarget, spawnSshCommand, type SshProcess } from './command-ssh'

/** SSH をテストで差し替えるための境界。null は「接続先を用意できない」 */
export type SpawnSsh = (host: CommandHost, remoteCommand: string) => SshProcess | null

export type ExecuteInput = {
  runId: string
  workerId: string
  def: CommandDef
  host: CommandHost
  params: CommandInputValues
  spawnSsh?: SpawnSsh
}

/** 既定の起動。鍵か known_hosts が解決できなければ実行しない(fail closed) */
const defaultSpawnSsh: SpawnSsh = (host, remoteCommand) => {
  const target = resolveSshTarget(host)
  return target ? spawnSshCommand(target, remoteCommand) : null
}

/**
 * 終了コードと打ち切りの理由から最終状態を決める。
 *
 * 純関数にしてあるので、SSH を張らずに全パターンをテストできる。
 */
export const resolveOutcome = (input: {
  exitCode: number | null
  aborted: CommandFailureKind | null
  sentinelSeen: boolean
}): { status: 'succeeded' | 'failed' | 'canceled'; failureKind?: CommandFailureKind } => {
  const { exitCode, aborted, sentinelSeen } = input

  if (aborted === 'canceled') {
    return { status: 'canceled', failureKind: 'canceled' }
  }
  if (aborted) {
    return { status: 'failed', failureKind: aborted }
  }
  if (exitCode === 0) {
    return { status: 'succeeded' }
  }
  /**
   * ssh は接続不可・認証失敗・ホスト鍵不一致でも 255 を返すため、
   * リモートコマンドが 255 で終わった場合と区別できない。
   * 番兵を観測していれば「リモートで我々のコマンドが起動した」ことが確定する。
   */
  if (exitCode === 255 && !sentinelSeen) {
    return { status: 'failed', failureKind: 'ssh_error' }
  }
  if (exitCode === null) {
    return { status: 'failed', failureKind: sentinelSeen ? 'connection_lost' : 'start_failed' }
  }
  return { status: 'failed' }
}

/**
 * ストリームを取り込み、番兵行だけを落としてバッファへ流す。
 *
 * チャンク境界でマルチバイト文字が割れるので、ストリームごとに `StringDecoder` を持つ。
 * 番兵の判定は行単位なので、改行で終わっていない末尾は次のチャンクまで持ち越す。
 */
const pipeStream = (
  stream: NodeJS.ReadableStream,
  kind: 'stdout' | 'stderr',
  buffer: LogBuffer,
  onSentinel: () => void,
  onChunk: () => void,
): void => {
  const decoder = new StringDecoder('utf8')
  let carry = ''

  const emit = (lines: string[]) => {
    const kept = lines.filter((line) => {
      if (isSentinelLine(line)) {
        onSentinel()
        return false
      }
      return true
    })
    if (kept.length > 0) {
      buffer.push(kind, `${kept.join('\n')}\n`)
      onChunk()
    }
  }

  stream.on('data', (chunk: Buffer) => {
    const lines = (carry + decoder.write(chunk)).split('\n')
    // 最後の要素は改行で終わっていない断片。次のチャンクと繋ぐ
    carry = lines.pop() ?? ''
    emit(lines)
  })

  stream.on('end', () => {
    const rest = carry + decoder.end()
    carry = ''
    if (rest.length > 0) {
      emit([rest])
    }
  })

  // 読み取り側のエラーで実行ごと落とさない。結果は終了コードで判断する
  stream.on('error', (error) => logger.warn({ error, kind }, 'command output stream error'))
}

/**
 * 実行を最後まで進める。
 *
 * 呼び出し元(`command-dispatch.ts`)は `await` しない。tick を短く保ち、
 * 実行の寿命はプロセスの寿命の側に置く。
 */
export const executeCommandRun = async (input: ExecuteInput): Promise<void> => {
  const { runId, workerId, def, host, params, spawnSsh = defaultSpawnSsh } = input
  const buffer = createLogBuffer(runId, workerId)

  let aborted: CommandFailureKind | null = null
  let sentinelSeen = false
  let flushFailures = 0
  let finished = false
  /** 書き出しの多重起動を防ぐ。間隔とサイズ閾値の両方から呼ばれる */
  let flushing = false

  let args: string[]
  try {
    args = resolveCommandArgs(def, params)
  } catch (error) {
    // 待っている間に定義が変わって選択肢が消えた、など。実行前に閉じる
    logger.error({ error, runId }, 'command args could not be resolved')
    await appendSystemChunk(runId, '選択された値が現在の定義と一致しないため実行できません。')
    await finishCommandRun({ runId, workerId, status: 'failed', exitCode: null, failureKind: 'start_failed' })
    return
  }

  const child = spawnSsh(host, buildRemoteCommand(def.executable, args))
  if (!child) {
    await appendSystemChunk(runId, '接続先の秘密鍵または known_hosts を読み込めないため実行できません。')
    await finishCommandRun({ runId, workerId, status: 'failed', exitCode: null, failureKind: 'start_failed' })
    return
  }

  /**
   * 中断の実体。
   *
   * まず stdin を閉じる。リモート側に wrapper を置いている場合はこれが EOF になり、
   * リモートのプロセスグループごと落ちる。置いていない場合に備えて SIGTERM → SIGKILL も続ける。
   */
  const abort = (reason: CommandFailureKind) => {
    if (aborted || finished) {
      return
    }
    aborted = reason
    child.closeStdin()
    setTimeout(() => child.kill('SIGTERM'), COMMAND_ABORT_GRACE_MS).unref()
    setTimeout(() => child.kill('SIGKILL'), COMMAND_ABORT_GRACE_MS + COMMAND_KILL_GRACE_MS).unref()
  }

  registerRun(runId, { abort })

  const flushNow = async () => {
    if (flushing || finished) {
      return
    }
    flushing = true
    try {
      const owned = await buffer.flush()
      flushFailures = 0
      if (!owned) {
        // stale 回収が先に閉じた。確定済みの結果を上書きせず、こちらは降りる
        abort('interrupted')
        return
      }
      signalRun(runId)
    } catch (error) {
      flushFailures += 1
      logger.warn({ error, runId, flushFailures }, 'command log flush failed')
      if (flushFailures >= COMMAND_FLUSH_MAX_RETRIES) {
        abort('log_write_failed')
      }
    } finally {
      flushing = false
    }
  }

  const onChunk = () => {
    if (isRunaway(buffer.received())) {
      abort('output_limit')
      return
    }
    // 溜まりすぎたら間隔を待たずに書き出す
    if (buffer.shouldFlush()) {
      void flushNow()
    }
  }

  pipeStream(child.stdout, 'stdout', buffer, () => (sentinelSeen = true), onChunk)
  pipeStream(child.stderr, 'stderr', buffer, () => (sentinelSeen = true), onChunk)

  const timeout = setTimeout(() => abort('timeout'), def.timeoutSec * 1000)
  timeout.unref()

  // 出力が無いコマンドでも生存申告が要るので、書くものが無くても回す
  const flushTimer = setInterval(() => void flushNow(), COMMAND_FLUSH_INTERVAL_MS)
  flushTimer.unref()

  /**
   * 登録を外すのは必ずこの `finally`。
   *
   * ここを通らないとレジストリに実行が残り、`runningCount()` が数える同時実行枠を
   * プロセスの再起動まで食い潰す。DB 側の行は `reclaimStaleRuns()` が生存申告の途切れで閉じるので、
   * 異常経路でも「枠だけ残る」状態を作らないことがここの役目。
   */
  try {
    const { code } = await child.wait()
    finished = true

    // 残りを書き切る。ここで失敗しても実行の結果は記録する
    try {
      await buffer.flush()
    } catch (error) {
      logger.warn({ error, runId }, 'final command log flush failed')
      // 終了コードが 0 でも履歴が欠けていることを読み取れるようにする
      await appendSystemChunk(runId, 'ログの一部を保存できなかったため、履歴が途中で欠けています。')
    }

    const outcome = resolveOutcome({ exitCode: code, aborted, sentinelSeen })
    const notice = outcome.failureKind ? FAILURE_NOTICE[outcome.failureKind] : undefined
    if (notice) {
      await appendSystemChunk(runId, notice(def))
    }

    await finishCommandRun({
      runId,
      workerId,
      status: outcome.status,
      exitCode: code,
      failureKind: outcome.failureKind,
    })
  } finally {
    finished = true
    clearTimeout(timeout)
    clearInterval(flushTimer)
    unregisterRun(runId)
    signalRun(runId)
  }
}

/**
 * 打ち切りの理由を利用者向けの1行にする。
 *
 * 分類がそのままでは何が起きたか読み取れないので、履歴の末尾に説明を残す。
 * 接続先や鍵のパスは秘密なので含めない。
 */
const FAILURE_NOTICE: Partial<Record<CommandFailureKind, (def: CommandDef) => string>> = {
  timeout: (def) => `タイムアウト(${def.timeoutSec}秒)により中断しました。`,
  output_limit: () => '出力が異常に多いため中断しました。',
  ssh_error: () => '接続に失敗しました。ホスト鍵・鍵の権限・接続先の設定を確認してください。',
  connection_lost: () => '実行中に接続が切れました。リモート側の状態を確認してください。',
  log_write_failed: () => 'ログを保存できなかったため中断しました。',
  canceled: () => '中断されました。',
}

/** 中断要求を、このプロセスが掴んでいる実行へ反映する */
export const applyCancel = (runId: string): boolean => abortRun(runId, 'canceled')
