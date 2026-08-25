/**
 * エージェントトークンの生成と検証。
 *
 * `verifyAgentToken` は DB を引くので prisma をこのファイル内で差し替える
 * (vitest.setup.ts のグローバルモックは agentToken を持たない)。
 * agentToken 以外のモデルは、`@/lib/auth` の初期化が引く分だけ setup と同じスタブで受ける。
 */

import {
  AGENT_TOKEN_PREFIX,
  generateAgentToken,
  hashAgentToken,
  isAgentToken,
  verifyAgentToken,
} from '@/lib/agent-token'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => {
  const agentToken = { findUnique: vi.fn(), update: vi.fn() }
  return {
    prisma: new Proxy({ agentToken } as Record<string, unknown>, {
      get: (target, prop: string) =>
        prop in target
          ? target[prop]
          : {
              findFirst: async () => ({}),
              findUnique: async () => ({}),
              create: async ({ data }: { data: unknown }) => data,
              update: async ({ data }: { data: unknown }) => data,
            },
    }),
  }
})

const findUnique = vi.mocked(prisma.agentToken.findUnique)
const update = vi.mocked(prisma.agentToken.update)

const agentUser = { id: 'a1', name: 'レビューBot', email: 'review-bot@agents.invalid', role: null }

/** `verifyAgentToken` が select している形のフェイク行 */
const fakeRow = (override: Record<string, unknown> = {}) => ({
  id: 'token-1',
  expiresAt: null,
  revokedAt: null,
  lastUsedAt: null,
  user: { ...agentUser, banned: false, isAgent: true },
  ...override,
})

beforeEach(() => {
  vi.clearAllMocks()
  update.mockResolvedValue({} as never)
})

describe('isAgentToken', () => {
  it('接頭辞が付いていればエージェント用と判定する', () => {
    expect(isAgentToken(`${AGENT_TOKEN_PREFIX}abc`)).toBe(true)
  })

  it('OAuth のアクセストークン(JWT)は対象外', () => {
    expect(isAgentToken('eyJhbGciOiJSUzI1NiIsInR5cCI6ImF0K2p3dCJ9.e30.sig')).toBe(false)
  })
})

describe('generateAgentToken', () => {
  it('接頭辞付きのトークンと末尾のヒントを返す', () => {
    const { token, hint } = generateAgentToken()
    expect(token.startsWith(AGENT_TOKEN_PREFIX)).toBe(true)
    expect(token.endsWith(hint)).toBe(true)
    expect(hint).toHaveLength(6)
  })

  it('毎回異なる値になる', () => {
    expect(generateAgentToken().token).not.toBe(generateAgentToken().token)
  })
})

describe('hashAgentToken', () => {
  it('同じ入力からは同じハッシュ、違う入力からは違うハッシュになる', () => {
    expect(hashAgentToken('t')).toBe(hashAgentToken('t'))
    expect(hashAgentToken('t')).not.toBe(hashAgentToken('u'))
  })

  it('平文を含まない 64 桁の hex を返す', () => {
    const hash = hashAgentToken('devuntu_agent_secret')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain('secret')
  })
})

describe('verifyAgentToken', () => {
  it('平文ではなくハッシュで引く', async () => {
    findUnique.mockResolvedValue(fakeRow() as never)

    await verifyAgentToken('devuntu_agent_plain')

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: hashAgentToken('devuntu_agent_plain') } }),
    )
  })

  it('有効なトークンは MCP スコープ付きの認可情報を返す', async () => {
    findUnique.mockResolvedValue(fakeRow() as never)

    const res = await verifyAgentToken('devuntu_agent_plain')

    expect(res).toEqual({
      ok: true,
      auth: { user: agentUser, scopes: ['mcp'], kind: 'agent', clientId: 'token-1' },
    })
  })

  it('存在しないトークンは invalid_token', async () => {
    findUnique.mockResolvedValue(null as never)

    expect(await verifyAgentToken('devuntu_agent_unknown')).toEqual({ ok: false, error: 'invalid_token' })
  })

  it('失効済みは invalid_token', async () => {
    findUnique.mockResolvedValue(fakeRow({ revokedAt: new Date() }) as never)

    expect(await verifyAgentToken('devuntu_agent_plain')).toEqual({ ok: false, error: 'invalid_token' })
  })

  it('期限切れは invalid_token', async () => {
    findUnique.mockResolvedValue(fakeRow({ expiresAt: new Date(Date.now() - 1000) }) as never)

    expect(await verifyAgentToken('devuntu_agent_plain')).toEqual({ ok: false, error: 'invalid_token' })
  })

  it('期限内なら通る', async () => {
    findUnique.mockResolvedValue(fakeRow({ expiresAt: new Date(Date.now() + 60_000) }) as never)

    expect((await verifyAgentToken('devuntu_agent_plain')).ok).toBe(true)
  })

  it('エージェント印が無いユーザーのトークンは通さない', async () => {
    findUnique.mockResolvedValue(fakeRow({ user: { ...agentUser, banned: false, isAgent: false } }) as never)

    expect(await verifyAgentToken('devuntu_agent_plain')).toEqual({ ok: false, error: 'invalid_token' })
  })

  it('BAN されたエージェントのトークンは通さない', async () => {
    findUnique.mockResolvedValue(fakeRow({ user: { ...agentUser, banned: true, isAgent: true } }) as never)

    expect(await verifyAgentToken('devuntu_agent_plain')).toEqual({ ok: false, error: 'invalid_token' })
  })

  it('最終利用が未記録なら更新する', async () => {
    findUnique.mockResolvedValue(fakeRow() as never)

    await verifyAgentToken('devuntu_agent_plain')

    expect(update).toHaveBeenCalledTimes(1)
  })

  it('直近に使われていれば更新しない(リクエストごとの書き込みを避ける)', async () => {
    findUnique.mockResolvedValue(fakeRow({ lastUsedAt: new Date() }) as never)

    await verifyAgentToken('devuntu_agent_plain')

    expect(update).not.toHaveBeenCalled()
  })

  it('最終利用の記録に失敗しても認証は通す', async () => {
    findUnique.mockResolvedValue(fakeRow() as never)
    update.mockRejectedValue(new Error('db unavailable') as never)

    expect((await verifyAgentToken('devuntu_agent_plain')).ok).toBe(true)
  })

  it('前回の利用から間隔が空いていれば更新する', async () => {
    findUnique.mockResolvedValue(fakeRow({ lastUsedAt: new Date(Date.now() - 10 * 60 * 1000) }) as never)

    await verifyAgentToken('devuntu_agent_plain')

    expect(update).toHaveBeenCalledTimes(1)
  })
})
