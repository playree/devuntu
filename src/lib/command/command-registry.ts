/**
 * 実行中プロセスのハンドル表(サーバー専用)
 *
 * NOTE: プロセス内の Map なので、水平スケールすると別インスタンスが掴んだ実行は
 *       ここから止められない。ただし中断の要求は DB に残り、実行側が flush のたびに
 *       拾うので正しさは壊れず、反応が最大 `COMMAND_FLUSH_INTERVAL_MS` ぶん遅れるだけ。
 *       共有が必要になったらこのファイルの中身だけを差し替えればよい
 *       (`rate-limit.ts` / `cache.ts` と同じ扱い)。
 */

import { logger } from '../logger'
import { type CommandFailureKind } from './command'

export type RunHandle = {
  /** 実行を打ち切る。理由は終了時の failureKind になる */
  abort: (reason: CommandFailureKind) => void
}

const handles = new Map<string, RunHandle>()

export const registerRun = (runId: string, handle: RunHandle): void => {
  handles.set(runId, handle)
}

export const unregisterRun = (runId: string): void => {
  handles.delete(runId)
}

/**
 * 実行を打ち切る。このプロセスが掴んでいなければ false。
 *
 * false でも「止められなかった」だけで、DB のフラグは残るため
 * 掴んでいるプロセスがいずれ拾う。掴み手が消えていれば stale 回収が閉じる。
 */
export const abortRun = (runId: string, reason: CommandFailureKind): boolean => {
  const handle = handles.get(runId)
  if (!handle) {
    return false
  }
  logger.info({ runId, reason }, 'aborting command run')
  handle.abort(reason)
  return true
}

/** このプロセスが実行中の件数。同時実行数の枠を数えるのに使う */
export const runningCount = (): number => handles.size

/** プロセス終了時に子プロセスを道連れにする。DB の更新は間に合わない前提で同期的にできることだけ行う */
export const abortAllRuns = (reason: CommandFailureKind): void => {
  handles.forEach((handle) => handle.abort(reason))
  handles.clear()
}
