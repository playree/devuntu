/**
 * 実行のライフサイクルの単体テスト
 *
 * 固定したいのは `activeKey` の扱い。ここが崩れると
 * 「同じコマンドが二重に走る」か「二度と実行できない」のどちらかになる。
 */

import { COMMAND_ALREADY_RUNNING, COMMAND_QUEUE_FULL, type CommandDef } from '@/lib/command/command'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

vi.mock('@/lib/command/command-log', () => ({ appendSystemChunk: vi.fn() }))

const { appendSystemChunk } = await import('@/lib/command/command-log')

const prismaMock = vi.hoisted(() => ({ uniqueViolation: false }))

vi.mock('@/lib/prisma', () => {
  const commandRun = {
    create: vi.fn(),
    count: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  }
  return {
    prisma: { commandRun, $queryRaw: vi.fn() },
    isUniqueViolation: () => prismaMock.uniqueViolation,
  }
})

const { enqueueCommandRun, finishCommandRun, listCommandRuns, reclaimStaleRuns, requestCancelCommandRun } =
  await import('@/lib/command/command-run')

const def = (overrides: Partial<CommandDef> = {}): CommandDef => ({
  id: 'deploy-web',
  label: 'デプロイ',
  targetId: 'web01',
  executable: '/opt/bin/deploy.sh',
  args: [],
  inputs: [],
  timeoutSec: 900,
  requireConfirm: true,
  requireFreshSession: false,
  singleton: true,
  sortOrder: 0,
  ...overrides,
})

const enqueue = (overrides: Partial<CommandDef> = {}) =>
  enqueueCommandRun({
    def: def(overrides),
    targetLabel: 'Web',
    actor: { id: 'user-1', name: '実行者' },
    params: {},
    argsPreview: '/opt/bin/deploy.sh',
    maxQueued: 20,
  })

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.uniqueViolation = false
  vi.mocked(prisma.commandRun.count).mockResolvedValue(0 as never)
  vi.mocked(prisma.commandRun.create).mockResolvedValue({ id: 'run-1' } as never)
  vi.mocked(prisma.commandRun.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.commandRun.findMany).mockResolvedValue([] as never)
})

describe('enqueueCommandRun / activeKey', () => {
  it('singleton なら commandKey を占有キーにする', async () => {
    await enqueue({ singleton: true })
    const arg = vi.mocked(prisma.commandRun.create).mock.calls[0][0] as { data: { activeKey: string | null } }
    expect(arg.data.activeKey).toBe('deploy-web')
  })

  it('singleton でなければ占有キーを持たせない', async () => {
    // null 同士は一意制約の対象外なので、何本でも並行できる
    await enqueue({ singleton: false })
    const arg = vi.mocked(prisma.commandRun.create).mock.calls[0][0] as { data: { activeKey: string | null } }
    expect(arg.data.activeKey).toBeNull()
  })

  it('一意制約違反は「既に実行中」として返す', async () => {
    // 件数を数えてから INSERT するより競合に強い(数えた直後に割り込まれる隙間が無い)
    prismaMock.uniqueViolation = true
    vi.mocked(prisma.commandRun.create).mockRejectedValue(new Error('unique'))
    await expect(enqueue()).rejects.toMatchObject({ errorType: COMMAND_ALREADY_RUNNING })
  })

  it('一意制約違反以外はそのまま投げる', async () => {
    prismaMock.uniqueViolation = false
    vi.mocked(prisma.commandRun.create).mockRejectedValue(new Error('boom'))
    await expect(enqueue()).rejects.toThrow('boom')
  })

  it('順番待ちが上限に達していたら拒否する', async () => {
    vi.mocked(prisma.commandRun.count).mockResolvedValue(20 as never)
    await expect(enqueue()).rejects.toMatchObject({ errorType: COMMAND_QUEUE_FULL })
    expect(prisma.commandRun.create).not.toHaveBeenCalled()
  })

  it('実行時点の表示名を複写する', async () => {
    // 定義が変わっても履歴の意味が変わらないようにする
    await enqueue({ label: 'デプロイ v1' })
    const arg = vi.mocked(prisma.commandRun.create).mock.calls[0][0] as {
      data: { commandLabel: string; targetLabel: string; userName: string }
    }
    expect(arg.data).toMatchObject({ commandLabel: 'デプロイ v1', targetLabel: 'Web', userName: '実行者' })
  })
})

describe('finishCommandRun', () => {
  it('自分が掴んだ running だけを閉じ、占有キーを戻す', async () => {
    expect(await finishCommandRun({ runId: 'run-1', workerId: 'worker-1', status: 'succeeded', exitCode: 0 })).toBe(
      true,
    )
    const arg = vi.mocked(prisma.commandRun.updateMany).mock.calls[0][0] as {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }
    // 条件付き更新にしないと、回収が先に閉じた結果を上書きしてしまう
    expect(arg.where).toMatchObject({ id: 'run-1', status: 'running', workerId: 'worker-1' })
    // 戻し忘れると次の実行が永久に弾かれる
    expect(arg.data).toMatchObject({ status: 'succeeded', activeKey: null, workerId: null })
  })

  it('既に閉じられていたら false', async () => {
    vi.mocked(prisma.commandRun.updateMany).mockResolvedValue({ count: 0 } as never)
    expect(await finishCommandRun({ runId: 'run-1', workerId: 'worker-1', status: 'failed', exitCode: 1 })).toBe(false)
  })
})

describe('requestCancelCommandRun', () => {
  it('順番待ちならその場で確定し、占有キーを戻す', async () => {
    vi.mocked(prisma.commandRun.updateMany).mockResolvedValueOnce({ count: 1 } as never)
    expect(await requestCancelCommandRun('run-1', 'user-1')).toBe('canceled')
    const arg = vi.mocked(prisma.commandRun.updateMany).mock.calls[0][0] as {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }
    expect(arg.where).toMatchObject({ status: 'queued' })
    expect(arg.data).toMatchObject({ status: 'canceled', activeKey: null })
  })

  it('実行中はフラグを立てるだけ', async () => {
    // 別プロセスの子プロセスは kill できないので、合図は必ず DB を経由させる
    vi.mocked(prisma.commandRun.updateMany)
      .mockResolvedValueOnce({ count: 0 } as never)
      .mockResolvedValueOnce({ count: 1 } as never)
    expect(await requestCancelCommandRun('run-1', 'user-1')).toBe('running')
    const arg = vi.mocked(prisma.commandRun.updateMany).mock.calls[1][0] as { data: Record<string, unknown> }
    expect(arg.data).not.toHaveProperty('status')
  })

  it('既に終わっていれば何もしない', async () => {
    vi.mocked(prisma.commandRun.updateMany).mockResolvedValue({ count: 0 } as never)
    expect(await requestCancelCommandRun('run-1', 'user-1')).toBeNull()
  })
})

describe('reclaimStaleRuns', () => {
  /** $queryRaw へ渡された SQL。埋め込む値は ? に潰して本文だけを見る */
  const lastSql = () => (vi.mocked(prisma.$queryRaw).mock.calls[0][0] as unknown as string[]).join('?')

  it('生存申告が途切れた実行を失敗として閉じる', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: 'run-1' }] as never)
    expect(await reclaimStaleRuns(new Date())).toBe(1)

    const sql = lastSql()
    // 副作用のあるコマンドを勝手に再実行しないため、queued へは戻さない
    expect(sql).toContain(`"status" = 'failed'`)
    expect(sql).toContain(`"failureKind" = 'interrupted'`)
    expect(sql).toContain('"activeKey" = NULL')
    expect(sql).not.toContain(`= 'queued'`)
    expect(appendSystemChunk).toHaveBeenCalledTimes(1)
  })

  it('回収の条件を更新と同じ1文に入れる', async () => {
    // 抽出と更新に分けると、その隙間に生存申告を入れた動いている実行まで閉じてしまう
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never)
    await reclaimStaleRuns(new Date())

    expect(lastSql()).toContain('"heartbeatAt"')
    expect(prisma.commandRun.findMany).not.toHaveBeenCalled()
  })

  it('対象が無ければ何もしない', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never)
    expect(await reclaimStaleRuns(new Date())).toBe(0)
    expect(appendSystemChunk).not.toHaveBeenCalled()
  })
})

describe('listCommandRuns', () => {
  beforeEach(() => {
    vi.mocked(prisma.commandRun.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.commandRun.count).mockResolvedValue(0 as never)
  })

  const query = {
    status: [] as never[],
    page: 1,
    rowsPerPage: 20,
    sortColumn: 'queuedAt' as const,
    sortDirection: 'descending' as const,
  }

  it('userId を渡せば自分の実行だけに絞る', async () => {
    await listCommandRuns({ ...query, userId: 'user-1' })
    expect(vi.mocked(prisma.commandRun.findMany).mock.calls[0][0]).toMatchObject({ where: { userId: 'user-1' } })
  })

  it('userId が null なら絞り込まない(管理者の全件表示)', async () => {
    await listCommandRuns({ ...query, userId: null })
    expect(vi.mocked(prisma.commandRun.findMany).mock.calls[0][0]?.where).toEqual({})
  })

  it('並び順は必ず id で決着させる', async () => {
    // 同値の行が page をまたいで重複・欠落しないようにする
    await listCommandRuns({ ...query, userId: 'user-1' })
    expect(vi.mocked(prisma.commandRun.findMany).mock.calls[0][0]?.orderBy).toEqual([
      { queuedAt: 'desc' },
      { id: 'desc' },
    ])
  })

  it('状態で絞り込める', async () => {
    await listCommandRuns({ ...query, userId: null, status: ['failed', 'canceled'] as never })
    expect(vi.mocked(prisma.commandRun.findMany).mock.calls[0][0]?.where).toEqual({
      status: { in: ['failed', 'canceled'] },
    })
  })

  it('ページングは 1 始まり', async () => {
    await listCommandRuns({ ...query, userId: null, page: 3, rowsPerPage: 20 })
    expect(vi.mocked(prisma.commandRun.findMany).mock.calls[0][0]).toMatchObject({ skip: 40, take: 20 })
  })
})
