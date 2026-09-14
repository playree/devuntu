/**
 * 実行ログの蓄積の単体テスト
 *
 * 固定したいのは「上限に達しても実行を殺さないこと」と
 * 「所有権を失ったら書き込みをやめること」の2点。
 */

import { COMMAND_MAX_OUTPUT_BYTES } from '@/lib/command/command'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

vi.mock('@/lib/prisma', () => {
  const commandRun = { updateMany: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() }
  const commandRunChunk = { createMany: vi.fn(), create: vi.fn(), findMany: vi.fn() }
  const models = { commandRun, commandRunChunk }
  return {
    prisma: {
      ...models,
      $transaction: vi.fn(async (arg: unknown) =>
        typeof arg === 'function' ? await (arg as (tx: unknown) => unknown)(models) : Promise.all(arg as unknown[]),
      ),
    },
  }
})

const { createLogBuffer, sanitizeLogText, touchRun } = await import('@/lib/command/command-log')

/** 所有権あり(updateMany が1行更新した)として振る舞わせる */
const grantOwnership = (lastSeq = 10) => {
  vi.mocked(prisma.commandRun.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.commandRun.findUniqueOrThrow).mockResolvedValue({ lastSeq } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  grantOwnership()
  vi.mocked(prisma.commandRunChunk.createMany).mockResolvedValue({ count: 1 } as never)
})

describe('sanitizeLogText', () => {
  it('NUL を落とす', () => {
    // PostgreSQL の text は NUL を格納できない。バイナリを吐くコマンドで実行ごと失敗させない
    expect(sanitizeLogText('a\u0000b')).toBe('ab')
  })

  it('孤立サロゲートを置換文字へ倒す', () => {
    expect(sanitizeLogText('a\uD800b')).toBe('a�b')
    expect(sanitizeLogText('a\uDC00b')).toBe('a�b')
  })

  it('正しいサロゲートペアはそのまま残す', () => {
    expect(sanitizeLogText('絵文字🚀です')).toBe('絵文字🚀です')
  })
})

describe('createLogBuffer', () => {
  it('溜めた分をまとめて1回で書く', async () => {
    const buffer = createLogBuffer('run-1', 'worker-1')
    buffer.push('stdout', 'a\n')
    buffer.push('stdout', 'b\n')
    expect(await buffer.flush()).toBe(true)

    expect(prisma.commandRunChunk.createMany).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(prisma.commandRunChunk.createMany).mock.calls[0][0] as { data: { seq: number }[] }
    // seq は保存済みの最大 +1 から連番。欠番も逆転も作らない
    expect(arg.data.map((chunk) => chunk.seq)).toEqual([9, 10])
  })

  it('書くものが無くても所有権の確認はする', async () => {
    // 出力の無いコマンドでも生存申告が要る。しないと running のまま回収されてしまう
    const buffer = createLogBuffer('run-1', 'worker-1')
    expect(await buffer.flush()).toBe(true)
    expect(prisma.commandRun.updateMany).toHaveBeenCalled()
    expect(prisma.commandRunChunk.createMany).not.toHaveBeenCalled()
  })

  it('所有権を失っていたら false を返す', async () => {
    // stale 回収が先に閉じた場合。呼び出し元はここで打ち切る
    vi.mocked(prisma.commandRun.updateMany).mockResolvedValue({ count: 0 } as never)
    const buffer = createLogBuffer('run-1', 'worker-1')
    buffer.push('stdout', 'x\n')
    expect(await buffer.flush()).toBe(false)
    expect(prisma.commandRunChunk.createMany).not.toHaveBeenCalled()
  })

  it('上限を超えたら保存を止めるが、受け取り自体は続ける', async () => {
    // ログが長いだけの正常なジョブを殺さない
    const buffer = createLogBuffer('run-1', 'worker-1')
    const chunk = 'x'.repeat(64 * 1024)
    for (let i = 0; i < Math.ceil(COMMAND_MAX_OUTPUT_BYTES / chunk.length) + 2; i += 1) {
      buffer.push('stdout', chunk)
    }
    expect(buffer.truncated()).toBe(true)
    expect(buffer.received()).toBeGreaterThan(COMMAND_MAX_OUTPUT_BYTES)
  })

  it('打ち切りの説明を1度だけ入れる', async () => {
    const buffer = createLogBuffer('run-1', 'worker-1')
    const chunk = 'x'.repeat(COMMAND_MAX_OUTPUT_BYTES)
    buffer.push('stdout', chunk)
    buffer.push('stdout', chunk)
    buffer.push('stdout', chunk)
    await buffer.flush()

    const arg = vi.mocked(prisma.commandRunChunk.createMany).mock.calls[0][0] as {
      data: { stream: string; text: string }[]
    }
    const notices = arg.data.filter((chunk) => chunk.stream === 'system')
    expect(notices).toHaveLength(1)
    expect(notices[0].text).toContain('上限')
  })

  it('サイズ閾値に達したら間隔を待たずに書くよう知らせる', () => {
    const buffer = createLogBuffer('run-1', 'worker-1')
    expect(buffer.shouldFlush()).toBe(false)
    buffer.push('stdout', 'x'.repeat(16 * 1024))
    expect(buffer.shouldFlush()).toBe(true)
  })
})

describe('touchRun', () => {
  it('自分が掴んだ running だけを更新する', async () => {
    vi.mocked(prisma.commandRun.updateMany).mockResolvedValue({ count: 1 } as never)
    expect(await touchRun('run-1', 'worker-1')).toBe(true)
    expect(vi.mocked(prisma.commandRun.updateMany).mock.calls[0][0]).toMatchObject({
      where: { id: 'run-1', status: 'running', workerId: 'worker-1' },
    })
  })

  it('他プロセスが掴み直していれば false', async () => {
    vi.mocked(prisma.commandRun.updateMany).mockResolvedValue({ count: 0 } as never)
    expect(await touchRun('run-1', 'worker-1')).toBe(false)
  })
})
