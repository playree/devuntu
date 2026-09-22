/**
 * 実行ログの蓄積の単体テスト
 *
 * 固定したいのは「上限に達しても実行を殺さないこと」と
 * 「所有権を失ったら書き込みをやめること」の2点。
 */

import { COMMAND_MAX_OUTPUT_BYTES } from '@/lib/command/command'
import { decodeSystemMessage } from '@/lib/command/command-log-message'
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
    expect(decodeSystemMessage(notices[0].text)).toEqual({ item: 'command_truncated' })
  })

  it('NUL だけの出力も受け取ったバイト数に数える', () => {
    // sanitize 後に数えると、NUL を出し続けるだけで暴走の判定をすり抜けられてしまう
    const buffer = createLogBuffer('run-1', 'worker-1')
    buffer.push('stdout', '\u0000'.repeat(1024))
    expect(buffer.received()).toBe(1024)
  })

  it('書き込みに失敗した分は次の書き出しへ持ち越す', async () => {
    // 捨ててしまうと、呼び出し元が再試行しても対象のログが残っていない
    const buffer = createLogBuffer('run-1', 'worker-1')
    buffer.push('stdout', 'a\n')
    buffer.push('stdout', 'b\n')

    vi.mocked(prisma.commandRunChunk.createMany).mockRejectedValueOnce(new Error('db down'))
    await expect(buffer.flush()).rejects.toThrow('db down')

    buffer.push('stdout', 'c\n')
    expect(await buffer.flush()).toBe(true)

    const arg = vi.mocked(prisma.commandRunChunk.createMany).mock.calls[1][0] as { data: { text: string }[] }
    expect(arg.data.map((chunk) => chunk.text)).toEqual(['a\n', 'b\n', 'c\n'])
  })

  it('並行して呼ばれても直列化し、seq を投入順に振る', async () => {
    // サイズ閾値の書き出しの最中に終了処理の書き出しが始まると、後から積んだ分の
    // トランザクションが先に lastSeq を取り、後の出力に小さい seq が付いて履歴の順序が逆転する
    let lastSeq = 0
    let active = 0
    let maxActive = 0
    vi.mocked(prisma.commandRun.updateMany).mockImplementation((async (args: {
      data: { lastSeq: { increment: number } }
    }) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      lastSeq += args.data.lastSeq.increment
      return { count: 1 }
    }) as never)
    vi.mocked(prisma.commandRun.findUniqueOrThrow).mockImplementation((async () => ({ lastSeq })) as never)
    vi.mocked(prisma.commandRunChunk.createMany).mockImplementation((async () => {
      // トランザクションの中に非同期の切れ目を作り、並走していれば割り込めるようにする
      await new Promise((resolve) => setTimeout(resolve, 0))
      active -= 1
      return { count: 1 }
    }) as never)

    const buffer = createLogBuffer('run-1', 'worker-1')
    buffer.push('stdout', 'a\n')
    const first = buffer.flush()
    // 先頭の書き出しが queue を切り離すところまで進めてから、次の分を積む
    await Promise.resolve()
    buffer.push('stdout', 'b\n')
    const second = buffer.flush()
    expect(await Promise.all([first, second])).toEqual([true, true])

    expect(maxActive).toBe(1)
    const written = vi
      .mocked(prisma.commandRunChunk.createMany)
      .mock.calls.flatMap((call) => (call[0] as { data: { seq: number; text: string }[] }).data)
    expect(written.map((chunk) => [chunk.seq, chunk.text])).toEqual([
      [1, 'a\n'],
      [2, 'b\n'],
    ])
  })

  it('直列化しても失敗した分の持ち越しは壊れない', async () => {
    // 失敗で queue へ戻した分を、後続の書き出しが先頭から拾えること
    const buffer = createLogBuffer('run-1', 'worker-1')
    buffer.push('stdout', 'a\n')
    vi.mocked(prisma.commandRunChunk.createMany).mockRejectedValueOnce(new Error('db down'))
    const failing = buffer.flush()
    await Promise.resolve()
    buffer.push('stdout', 'b\n')
    const following = buffer.flush()

    await expect(failing).rejects.toThrow('db down')
    expect(await following).toBe(true)

    const arg = vi.mocked(prisma.commandRunChunk.createMany).mock.calls[1][0] as { data: { text: string }[] }
    expect(arg.data.map((chunk) => chunk.text)).toEqual(['a\n', 'b\n'])
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
