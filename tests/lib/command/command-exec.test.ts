/**
 * 実行の進行の単体テスト
 *
 * SSH は `SshProcess` インタフェース越しにしか触っていないので、
 * `PassThrough` 2本と手で解決する Promise の偽物へ差し替えれば全経路を通せる。
 */

import {
  COMMAND_SENTINEL_MARK,
  COMMAND_START_SENTINEL,
  type CommandDef,
  type CommandTarget,
} from '@/lib/command/command'
import { type SshProcess } from '@/lib/command/command-ssh'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

const logMock = vi.hoisted(() => ({
  pushed: [] as { stream: string; text: string }[],
  flushResult: true,
  flushThrows: false,
  systemChunks: [] as string[],
}))

vi.mock('@/lib/command/command-log', () => ({
  createLogBuffer: () => {
    let received = 0
    return {
      push: (stream: string, text: string) => {
        logMock.pushed.push({ stream, text })
        received += Buffer.byteLength(text)
      },
      flush: async () => {
        if (logMock.flushThrows) {
          throw new Error('db down')
        }
        return logMock.flushResult
      },
      truncated: () => false,
      bytes: () => 0,
      received: () => received,
      pending: () => false,
      shouldFlush: () => false,
    }
  },
  isRunaway: () => false,
  appendSystemChunk: async (_runId: string, text: string) => {
    logMock.systemChunks.push(text)
  },
}))

const finishMock = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[], throws: false }))
vi.mock('@/lib/command/command-run', () => ({
  finishCommandRun: async (input: Record<string, unknown>) => {
    finishMock.calls.push(input)
    if (finishMock.throws) {
      throw new Error('db down')
    }
    return true
  },
}))

const { executeCommandRun, resolveOutcome } = await import('@/lib/command/command-exec')
const { runningCount } = await import('@/lib/command/command-registry')

const def: CommandDef = {
  id: 'deploy-web',
  label: 'デプロイ',
  targetId: 'web01',
  executable: '/opt/bin/deploy.sh',
  args: ['{{env}}'],
  inputs: [
    {
      type: 'select',
      key: 'env',
      label: '環境',
      required: true,
      options: [{ value: 'staging', label: 'stg' }],
    },
  ],
  timeoutSec: 900,
  requireConfirm: true,
  requireFreshSession: false,
  singleton: true,
  sortOrder: 0,
}

const target: CommandTarget = {
  id: 'web01',
  label: 'Web',
  kind: 'ssh',
  host: 'web01.internal',
  port: 22,
  user: 'deploy',
  identityFile: 'ops_ed25519',
  editable: false,
}

/** 手で終了させられる偽の ssh */
const createFakeSsh = () => {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  let resolveExit: (value: { code: number | null; signal: NodeJS.Signals | null }) => void = () => {}
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    resolveExit = resolve
  })
  const calls = { closeStdin: 0, kills: [] as string[] }

  const process: SshProcess = {
    stdout,
    stderr,
    wait: () => exit,
    closeStdin: () => {
      calls.closeStdin += 1
    },
    kill: (signal) => {
      calls.kills.push(signal)
    },
  }

  /** 出力を流し終えてから終了させる */
  const finish = async (code: number | null) => {
    stdout.end()
    stderr.end()
    await new Promise((resolve) => setImmediate(resolve))
    resolveExit({ code, signal: null })
  }

  return { process, stdout, stderr, finish, calls }
}

beforeEach(() => {
  logMock.pushed = []
  logMock.systemChunks = []
  logMock.flushResult = true
  logMock.flushThrows = false
  finishMock.calls = []
  finishMock.throws = false
  vi.useRealTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

const run = async (fake: ReturnType<typeof createFakeSsh>) =>
  executeCommandRun({
    runId: 'run-1',
    workerId: 'worker-1',
    def,
    target,
    params: { env: 'staging' },
    spawnSsh: () => fake.process,
  })

describe('resolveOutcome', () => {
  it('終了コード 0 は成功', () => {
    expect(resolveOutcome({ exitCode: 0, aborted: null, sentinelSeen: true })).toEqual({ status: 'succeeded' })
  })

  it('番兵を観測していない 255 は ssh 自身の失敗として扱う', () => {
    // 接続不可・認証失敗・ホスト鍵不一致はいずれも 255 で、リモートの 255 と区別できない
    expect(resolveOutcome({ exitCode: 255, aborted: null, sentinelSeen: false })).toEqual({
      status: 'failed',
      failureKind: 'ssh_error',
    })
  })

  it('番兵を観測した 255 は通常の終了コードとして扱う', () => {
    expect(resolveOutcome({ exitCode: 255, aborted: null, sentinelSeen: true })).toEqual({ status: 'failed' })
  })

  it('中断は canceled、それ以外の打ち切りは failed', () => {
    expect(resolveOutcome({ exitCode: null, aborted: 'canceled', sentinelSeen: true })).toEqual({
      status: 'canceled',
      failureKind: 'canceled',
    })
    expect(resolveOutcome({ exitCode: null, aborted: 'timeout', sentinelSeen: true })).toEqual({
      status: 'failed',
      failureKind: 'timeout',
    })
  })

  it('終了コードが無い場合は番兵の有無で分ける', () => {
    expect(resolveOutcome({ exitCode: null, aborted: null, sentinelSeen: true })).toEqual({
      status: 'failed',
      failureKind: 'connection_lost',
    })
    expect(resolveOutcome({ exitCode: null, aborted: null, sentinelSeen: false })).toEqual({
      status: 'failed',
      failureKind: 'start_failed',
    })
  })
})

describe('executeCommandRun', () => {
  it('正常終了を記録する', async () => {
    const fake = createFakeSsh()
    const promise = run(fake)
    fake.stdout.write('deploying\n')
    await fake.finish(0)
    await promise

    expect(finishMock.calls[0]).toMatchObject({ status: 'succeeded', exitCode: 0 })
    expect(logMock.pushed).toEqual([{ stream: 'stdout', text: 'deploying\n' }])
  })

  it('番兵行はログに残さない', async () => {
    const fake = createFakeSsh()
    const promise = run(fake)
    fake.stderr.write(`${COMMAND_SENTINEL_MARK}${COMMAND_START_SENTINEL}\n`)
    fake.stderr.write('warning\n')
    await fake.finish(0)
    await promise

    // 番兵はアプリの都合で挿し込んだ行なので、利用者には見せない
    expect(logMock.pushed).toEqual([{ stream: 'stderr', text: 'warning\n' }])
  })

  it('stdout と stderr を分けて記録する', async () => {
    const fake = createFakeSsh()
    const promise = run(fake)
    fake.stdout.write('out\n')
    fake.stderr.write('err\n')
    await fake.finish(1)
    await promise

    expect(logMock.pushed).toEqual([
      { stream: 'stdout', text: 'out\n' },
      { stream: 'stderr', text: 'err\n' },
    ])
    expect(finishMock.calls[0]).toMatchObject({ status: 'failed', exitCode: 1 })
  })

  it('改行で終わらない末尾も取りこぼさない', async () => {
    const fake = createFakeSsh()
    const promise = run(fake)
    fake.stdout.write('no newline at end')
    await fake.finish(0)
    await promise

    expect(logMock.pushed).toEqual([{ stream: 'stdout', text: 'no newline at end\n' }])
  })

  it('接続先を用意できなければ実行せず失敗として閉じる', async () => {
    await executeCommandRun({
      runId: 'run-1',
      workerId: 'worker-1',
      def,
      target,
      params: { env: 'staging' },
      spawnSsh: () => null,
    })
    expect(finishMock.calls[0]).toMatchObject({ status: 'failed', failureKind: 'start_failed' })
    expect(logMock.systemChunks[0]).toContain('known_hosts')
  })

  it('選択肢の外の値が残っていれば起動前に弾く', async () => {
    // 順番待ちの間に定義ファイルが変わった場合
    await executeCommandRun({
      runId: 'run-1',
      workerId: 'worker-1',
      def,
      target,
      params: { env: 'production' },
      spawnSsh: () => {
        throw new Error('should not spawn')
      },
    })
    expect(finishMock.calls[0]).toMatchObject({ status: 'failed', failureKind: 'start_failed' })
  })

  it('ログの保存に失敗しても実行の結果は記録する', async () => {
    // 結果まで失うと「何が起きたか分からない実行」が残ってしまう
    logMock.flushThrows = true
    const fake = createFakeSsh()
    const promise = run(fake)
    fake.stdout.write('working\n')
    await fake.finish(0)
    await promise

    expect(finishMock.calls[0]).toMatchObject({ status: 'succeeded', exitCode: 0 })
  })

  it('最終の書き出しに失敗したら履歴が欠けたことを残す', async () => {
    // 終了コードが 0 だと succeeded で確定するため、これが無いと欠落を判別できない
    logMock.flushThrows = true
    const fake = createFakeSsh()
    const promise = run(fake)
    fake.stdout.write('working\n')
    await fake.finish(0)
    await promise

    expect(logMock.systemChunks.some((text) => text.includes('欠けています'))).toBe(true)
  })

  it('終了時は必ず finishCommandRun を1回だけ呼ぶ', async () => {
    const fake = createFakeSsh()
    const promise = run(fake)
    await fake.finish(0)
    await promise
    expect(finishMock.calls).toHaveLength(1)
  })

  it('終了の記録に失敗しても実行枠を解放する', async () => {
    // 解放し損ねるとレジストリに残り続け、同時実行の枠をプロセス再起動まで食い潰す
    finishMock.throws = true
    const fake = createFakeSsh()
    const promise = run(fake)
    await fake.finish(0)
    await expect(promise).rejects.toThrow('db down')

    expect(runningCount()).toBe(0)
  })
})
