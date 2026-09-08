/**
 * 期限切れ行の掃除の単体テスト
 *
 * 危ないのは条件そのもの(生きている行を巻き込まないか)なので、
 * prisma を差し替えて `deleteMany` へ渡る `where` の形を検証する。
 */

import {
  AGENT_RUN_KEEP_PER_RUNNER,
  OAUTH_TOKEN_RETENTION_MS,
  retentionBefore,
  SESSION_RETENTION_MS,
  VERIFICATION_RETENTION_MS,
} from '@/lib/maintenance/maintenance'
import {
  runMaintenanceSweep,
  sweepAgentRuns,
  sweepOauthAccessTokens,
  sweepOauthClientAssertions,
  sweepOauthRefreshTokens,
  sweepSessions,
  sweepUploadNonces,
  sweepVerifications,
} from '@/lib/maintenance/maintenance-sweep'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    session: { deleteMany: vi.fn() },
    verification: { deleteMany: vi.fn() },
    oauthRefreshToken: { deleteMany: vi.fn() },
    oauthAccessToken: { deleteMany: vi.fn() },
    oauthClientAssertion: { deleteMany: vi.fn() },
    uploadNonce: { deleteMany: vi.fn() },
    agentRun: { deleteMany: vi.fn(), findMany: vi.fn() },
    agentRunner: { findMany: vi.fn() },
  },
}))

// 添付の掃除はストレージを触るので、条件の検証では止めておく
vi.mock('@/lib/maintenance/maintenance-attachment', () => ({
  sweepOrphanAttachments: vi.fn(async () => 0),
}))

const now = new Date('2026-09-08T10:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  for (const model of [
    prisma.session,
    prisma.verification,
    prisma.oauthRefreshToken,
    prisma.oauthAccessToken,
    prisma.oauthClientAssertion,
    prisma.uploadNonce,
    prisma.agentRun,
  ]) {
    vi.mocked(model.deleteMany).mockResolvedValue({ count: 0 })
  }
  vi.mocked(prisma.agentRunner.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.agentRun.findMany).mockResolvedValue([] as never)
})

describe('sweepSessions', () => {
  it('保持期間を過ぎた期限切れだけを消す', async () => {
    await sweepSessions(now)
    expect(vi.mocked(prisma.session.deleteMany).mock.calls[0][0]).toEqual({
      where: { expiresAt: { lt: retentionBefore(now, SESSION_RETENTION_MS) } },
    })
  })

  it('境界は現在時刻ではなく保持期間ぶん過去(処理中のリクエストを巻き込まない)', async () => {
    await sweepSessions(now)
    const where = vi.mocked(prisma.session.deleteMany).mock.calls[0][0]?.where as {
      expiresAt: { lt: Date }
    }
    expect(where.expiresAt.lt.getTime()).toBeLessThan(now.getTime())
  })
})

describe('sweepVerifications', () => {
  it('expiresAt だけで判断する(用途で絞らない)', async () => {
    await sweepVerifications(now)
    expect(vi.mocked(prisma.verification.deleteMany).mock.calls[0][0]).toEqual({
      where: { expiresAt: { lt: retentionBefore(now, VERIFICATION_RETENTION_MS) } },
    })
  })
})

describe('sweepOauthRefreshTokens', () => {
  const whereOf = () =>
    vi.mocked(prisma.oauthRefreshToken.deleteMany).mock.calls[0][0]?.where as {
      AND: { OR: Record<string, unknown>[] }[]
      oauthaccesstokens: { none: Record<string, unknown> }
    }

  it('生きているアクセストークンを持つ行は対象外にする', async () => {
    // Cascade で有効なトークンまで道連れにしないための歯止め
    await sweepOauthRefreshTokens(now)
    expect(whereOf().oauthaccesstokens).toEqual({ none: { expiresAt: { gte: now }, revoked: null } })
  })

  it('ローテーション再提示の検出期間が終わるまで消さない', async () => {
    await sweepOauthRefreshTokens(now)
    expect(whereOf().AND[1].OR).toEqual([{ rotationReplayExpiresAt: null }, { rotationReplayExpiresAt: { lt: now } }])
  })

  it('期限切れか失効済みのどちらかを対象にする', async () => {
    await sweepOauthRefreshTokens(now)
    const before = retentionBefore(now, OAUTH_TOKEN_RETENTION_MS)
    expect(whereOf().AND[0].OR).toEqual([{ expiresAt: { lt: before } }, { revoked: { lt: before } }])
  })
})

describe('sweepOauthAccessTokens', () => {
  it('期限切れか失効済みを消す', async () => {
    await sweepOauthAccessTokens(now)
    const before = retentionBefore(now, OAUTH_TOKEN_RETENTION_MS)
    expect(vi.mocked(prisma.oauthAccessToken.deleteMany).mock.calls[0][0]).toEqual({
      where: { OR: [{ expiresAt: { lt: before } }, { revoked: { lt: before } }] },
    })
  })
})

describe('sweepOauthClientAssertions / sweepUploadNonces', () => {
  it('猶予なしで期限切れを消す', async () => {
    await sweepOauthClientAssertions(now)
    await sweepUploadNonces(now)
    expect(vi.mocked(prisma.oauthClientAssertion.deleteMany).mock.calls[0][0]).toEqual({
      where: { expiresAt: { lt: now } },
    })
    expect(vi.mocked(prisma.uploadNonce.deleteMany).mock.calls[0][0]).toEqual({
      where: { expiresAt: { lt: now } },
    })
  })
})

describe('sweepAgentRuns', () => {
  it('実行中の行には触らない(時間切れの回収が持ち主)', async () => {
    await sweepAgentRuns(now)
    const where = vi.mocked(prisma.agentRun.deleteMany).mock.calls[0][0]?.where as { status: unknown }
    expect(where.status).toEqual({ not: 'running' })
  })

  it('ランナーごとに上限を超えた古い分を消す', async () => {
    vi.mocked(prisma.agentRunner.findMany).mockResolvedValue([{ id: 'runner-1' }] as never)
    vi.mocked(prisma.agentRun.findMany).mockResolvedValue([{ id: 'run-old' }] as never)
    vi.mocked(prisma.agentRun.deleteMany).mockResolvedValue({ count: 1 })

    const removed = await sweepAgentRuns(now)

    const args = vi.mocked(prisma.agentRun.findMany).mock.calls[0][0]
    expect(args?.skip, '新しい方から上限件を残す').toBe(AGENT_RUN_KEEP_PER_RUNNER)
    expect(args?.orderBy).toEqual([{ startedAt: 'desc' }, { id: 'desc' }])
    // 期間ぶん + 上限超過ぶん
    expect(removed).toBe(2)
  })

  it('上限を超えていなければ削除しない', async () => {
    vi.mocked(prisma.agentRunner.findMany).mockResolvedValue([{ id: 'runner-1' }] as never)
    vi.mocked(prisma.agentRun.findMany).mockResolvedValue([] as never)
    await sweepAgentRuns(now)
    expect(vi.mocked(prisma.agentRun.deleteMany)).toHaveBeenCalledTimes(1)
  })
})

describe('runMaintenanceSweep', () => {
  it('リフレッシュトークンをアクセストークンより先に処理する', async () => {
    await runMaintenanceSweep(now)
    // 逆順だと Cascade で生きたアクセストークンを消しうる
    expect(vi.mocked(prisma.oauthRefreshToken.deleteMany).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.oauthAccessToken.deleteMany).mock.invocationCallOrder[0],
    )
  })

  it('1手順が失敗しても残りの手順は動く', async () => {
    vi.mocked(prisma.session.deleteMany).mockRejectedValue(new Error('boom'))
    vi.mocked(prisma.verification.deleteMany).mockResolvedValue({ count: 3 })

    const counts = await runMaintenanceSweep(now)

    expect(counts.session, '失敗した手順は -1').toBe(-1)
    expect(counts.verification).toBe(3)
    expect(vi.mocked(prisma.uploadNonce.deleteMany)).toHaveBeenCalled()
  })
})
