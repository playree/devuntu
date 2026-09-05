/**
 * ユーザー用 MCP トークンの生成と検証。
 *
 * `verifyMcpToken` は DB を引くので prisma をこのファイル内で差し替える
 * (vitest.setup.ts のグローバルモックは mcpToken を持たない)。
 * mcpToken 以外のモデルは、`@/lib/auth` の初期化が引く分だけ setup と同じスタブで受ける。
 *
 * エージェント用トークンとの取り違えを防ぐのがこの経路の肝なので、接頭辞の相互排他と
 * エージェントユーザーの拒否は特に固定しておく。
 */

import { AGENT_TOKEN_PREFIX } from '@/lib/agent/agent'
import { hashAgentToken } from '@/lib/agent/agent-token'
import { MCP_TOKEN_PREFIX } from '@/lib/mcp/mcp'
import { generateMcpToken, hashMcpToken, isMcpToken, verifyMcpToken } from '@/lib/mcp/mcp-token'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => {
  const mcpToken = { findUnique: vi.fn(), update: vi.fn() }
  return {
    prisma: new Proxy({ mcpToken } as Record<string, unknown>, {
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

const findUnique = vi.mocked(prisma.mcpToken.findUnique)
const update = vi.mocked(prisma.mcpToken.update)

const user = { id: 'u1', name: '開発者', email: 'dev@example.com', role: null }

/** `verifyMcpToken` が select している形のフェイク行 */
const fakeRow = (override: Record<string, unknown> = {}) => ({
  id: 'token-1',
  expiresAt: null,
  lastUsedAt: null,
  user: { ...user, banned: false, isAgent: false },
  ...override,
})

beforeEach(() => {
  vi.clearAllMocks()
  update.mockResolvedValue({} as never)
})

describe('isMcpToken', () => {
  it('接頭辞が付いていればユーザー用と判定する', () => {
    expect(isMcpToken(`${MCP_TOKEN_PREFIX}abc`)).toBe(true)
  })

  it('エージェント用トークンは対象外(接頭辞が相互に前方一致しない)', () => {
    expect(isMcpToken(`${AGENT_TOKEN_PREFIX}abc`)).toBe(false)
    expect(MCP_TOKEN_PREFIX.startsWith(AGENT_TOKEN_PREFIX)).toBe(false)
    expect(AGENT_TOKEN_PREFIX.startsWith(MCP_TOKEN_PREFIX)).toBe(false)
  })

  it('OAuth のアクセストークン(JWT)は対象外', () => {
    expect(isMcpToken('eyJhbGciOiJSUzI1NiIsInR5cCI6ImF0K2p3dCJ9.e30.sig')).toBe(false)
  })
})

describe('generateMcpToken', () => {
  it('接頭辞付きのトークンと末尾のヒントを返す', () => {
    const { token, hint } = generateMcpToken()
    expect(token.startsWith(MCP_TOKEN_PREFIX)).toBe(true)
    expect(token.endsWith(hint)).toBe(true)
    expect(hint).toHaveLength(6)
  })

  it('毎回異なる値になる', () => {
    expect(generateMcpToken().token).not.toBe(generateMcpToken().token)
  })
})

describe('hashMcpToken', () => {
  it('平文を含まない 64 桁の hex を返す', () => {
    const hash = hashMcpToken('devuntu_pat_secret')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain('secret')
  })

  it('エージェント用と同じ方式なので、同じ入力からは同じハッシュになる', () => {
    expect(hashMcpToken('t')).toBe(hashAgentToken('t'))
    expect(hashMcpToken('t')).not.toBe(hashMcpToken('u'))
  })
})

describe('verifyMcpToken', () => {
  it('平文ではなくハッシュで引く', async () => {
    findUnique.mockResolvedValue(fakeRow() as never)

    await verifyMcpToken('devuntu_pat_plain')

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: hashMcpToken('devuntu_pat_plain') } }),
    )
  })

  it('有効なトークンは MCP スコープ付きの認可情報を返す', async () => {
    findUnique.mockResolvedValue(fakeRow() as never)

    expect(await verifyMcpToken('devuntu_pat_plain')).toEqual({
      ok: true,
      auth: { user, scopes: ['mcp'], kind: 'pat', clientId: 'token-1' },
    })
  })

  it('存在しないトークンは invalid_token', async () => {
    findUnique.mockResolvedValue(null as never)

    expect(await verifyMcpToken('devuntu_pat_unknown')).toEqual({ ok: false, error: 'invalid_token' })
  })

  it('期限切れは invalid_token', async () => {
    findUnique.mockResolvedValue(fakeRow({ expiresAt: new Date(Date.now() - 1000) }) as never)

    expect(await verifyMcpToken('devuntu_pat_plain')).toEqual({ ok: false, error: 'invalid_token' })
  })

  it('期限内なら通る', async () => {
    findUnique.mockResolvedValue(fakeRow({ expiresAt: new Date(Date.now() + 60_000) }) as never)

    expect((await verifyMcpToken('devuntu_pat_plain')).ok).toBe(true)
  })

  it('エージェントユーザーのトークンは通さない(エージェント側とは条件が逆向き)', async () => {
    findUnique.mockResolvedValue(fakeRow({ user: { ...user, banned: false, isAgent: true } }) as never)

    expect(await verifyMcpToken('devuntu_pat_plain')).toEqual({ ok: false, error: 'invalid_token' })
  })

  it('BAN されたユーザーのトークンは通さない', async () => {
    findUnique.mockResolvedValue(fakeRow({ user: { ...user, banned: true, isAgent: false } }) as never)

    expect(await verifyMcpToken('devuntu_pat_plain')).toEqual({ ok: false, error: 'invalid_token' })
  })

  it('最終利用が未記録なら更新する', async () => {
    findUnique.mockResolvedValue(fakeRow() as never)

    await verifyMcpToken('devuntu_pat_plain')

    expect(update).toHaveBeenCalledTimes(1)
  })

  it('直近に使われていれば更新しない(リクエストごとの書き込みを避ける)', async () => {
    findUnique.mockResolvedValue(fakeRow({ lastUsedAt: new Date() }) as never)

    await verifyMcpToken('devuntu_pat_plain')

    expect(update).not.toHaveBeenCalled()
  })

  it('前回の利用から間隔が空いていれば更新する', async () => {
    findUnique.mockResolvedValue(fakeRow({ lastUsedAt: new Date(Date.now() - 10 * 60 * 1000) }) as never)

    await verifyMcpToken('devuntu_pat_plain')

    expect(update).toHaveBeenCalledTimes(1)
  })

  it('最終利用の記録に失敗しても認証は通す', async () => {
    findUnique.mockResolvedValue(fakeRow() as never)
    update.mockRejectedValue(new Error('db unavailable') as never)

    expect((await verifyMcpToken('devuntu_pat_plain')).ok).toBe(true)
  })
})
