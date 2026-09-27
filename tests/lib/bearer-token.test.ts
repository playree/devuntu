/**
 * Bearer 認証の長期トークン(エージェント用 / ユーザー用)の生成と検証
 *
 * 2つの経路は引くテーブル・接頭辞・持ち主に求める種別だけが違うので、同じ期待値を経路ごとに当てる。
 * 取り違えを防ぐのが肝なので、接頭辞の相互排他と種別の逆向きの判定は特に固定しておく。
 */

import { AGENT_TOKEN_PREFIX } from '@/lib/agent/agent'
import { generateAgentToken, hashAgentToken, isAgentToken, verifyAgentToken } from '@/lib/agent/agent-token'
import { shouldRefreshLastUsed } from '@/lib/bearer-token'
import { MCP_TOKEN_PREFIX } from '@/lib/mcp/mcp'
import { generateMcpToken, hashMcpToken, isMcpToken, verifyMcpToken } from '@/lib/mcp/mcp-token'
import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../helpers/prisma')).mockPrisma(
    { agentToken: ['findUnique', 'update'], mcpToken: ['findUnique', 'update'] },
    { stubOthers: true },
  ),
)

const agentUser = { id: 'a1', name: 'レビューBot', email: 'review-bot@agents.invalid', role: null }
const humanUser = { id: 'u1', name: '開発者', email: 'dev@example.com', role: null }

const routes = [
  {
    kind: 'agent',
    prefix: AGENT_TOKEN_PREFIX,
    otherPrefix: MCP_TOKEN_PREFIX,
    isToken: isAgentToken,
    generate: generateAgentToken,
    hash: hashAgentToken,
    verify: verifyAgentToken,
    table: () => prisma.agentToken,
    user: agentUser,
    isAgent: true,
  },
  {
    kind: 'pat',
    prefix: MCP_TOKEN_PREFIX,
    otherPrefix: AGENT_TOKEN_PREFIX,
    isToken: isMcpToken,
    generate: generateMcpToken,
    hash: hashMcpToken,
    verify: verifyMcpToken,
    table: () => prisma.mcpToken,
    user: humanUser,
    isAgent: false,
  },
] as const

beforeEach(() => {
  vi.clearAllMocks()
})

describe.each(routes)('$kind トークン', (route) => {
  const findUnique = () => vi.mocked(route.table().findUnique)
  const update = () => vi.mocked(route.table().update)
  const plain = `${route.prefix}plain`

  /** 検証が select している形のフェイク行 */
  const fakeRow = (override: Record<string, unknown> = {}) => ({
    id: 'token-1',
    expiresAt: null,
    lastUsedAt: null,
    user: { ...route.user, banned: false, isAgent: route.isAgent },
    ...override,
  })

  beforeEach(() => {
    update().mockResolvedValue({} as never)
  })

  describe('接頭辞の判定', () => {
    it('自分の接頭辞が付いていれば対象と判定する', () => {
      expect(route.isToken(`${route.prefix}abc`)).toBe(true)
    })

    it('もう一方の経路のトークンは対象外(接頭辞が相互に前方一致しない)', () => {
      expect(route.isToken(`${route.otherPrefix}abc`)).toBe(false)
      expect(route.prefix.startsWith(route.otherPrefix)).toBe(false)
    })

    it('OAuth のアクセストークン(JWT)は対象外', () => {
      expect(route.isToken('eyJhbGciOiJSUzI1NiIsInR5cCI6ImF0K2p3dCJ9.e30.sig')).toBe(false)
    })
  })

  describe('生成とハッシュ', () => {
    it('接頭辞付きのトークンと末尾のヒントを返す', () => {
      const { token, hint } = route.generate()
      expect(token.startsWith(route.prefix)).toBe(true)
      expect(token.endsWith(hint)).toBe(true)
      expect(hint).toHaveLength(6)
    })

    it('毎回異なる値になる', () => {
      expect(route.generate().token).not.toBe(route.generate().token)
    })

    it('平文を含まない 64 桁の hex を返す', () => {
      const hash = route.hash(`${route.prefix}secret`)
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
      expect(hash).not.toContain('secret')
    })

    it('同じ入力からは同じハッシュ、違う入力からは違うハッシュになる(経路をまたいでも同じ方式)', () => {
      expect(route.hash('t')).toBe(hashAgentToken('t'))
      expect(route.hash('t')).toBe(hashMcpToken('t'))
      expect(route.hash('t')).not.toBe(route.hash('u'))
    })
  })

  describe('検証', () => {
    it('平文ではなくハッシュで引く', async () => {
      findUnique().mockResolvedValue(fakeRow() as never)

      await route.verify(plain)

      expect(findUnique()).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: route.hash(plain) } }))
    })

    it('有効なトークンは MCP スコープ付きの認可情報を返す', async () => {
      findUnique().mockResolvedValue(fakeRow() as never)

      expect(await route.verify(plain)).toEqual({
        ok: true,
        auth: { user: route.user, scopes: ['mcp'], kind: route.kind, clientId: 'token-1' },
      })
    })

    it('存在しないトークンは invalid_token', async () => {
      findUnique().mockResolvedValue(null as never)

      expect(await route.verify(`${route.prefix}unknown`)).toEqual({ ok: false, error: 'invalid_token' })
    })

    it('期限切れは invalid_token', async () => {
      findUnique().mockResolvedValue(fakeRow({ expiresAt: new Date(Date.now() - 1000) }) as never)

      expect(await route.verify(plain)).toEqual({ ok: false, error: 'invalid_token' })
    })

    it('期限内なら通る', async () => {
      findUnique().mockResolvedValue(fakeRow({ expiresAt: new Date(Date.now() + 60_000) }) as never)

      expect((await route.verify(plain)).ok).toBe(true)
    })

    it('持ち主の種別が経路と逆なら通さない', async () => {
      findUnique().mockResolvedValue(
        fakeRow({ user: { ...route.user, banned: false, isAgent: !route.isAgent } }) as never,
      )

      expect(await route.verify(plain)).toEqual({ ok: false, error: 'invalid_token' })
    })

    it('BAN された持ち主のトークンは通さない', async () => {
      findUnique().mockResolvedValue(
        fakeRow({ user: { ...route.user, banned: true, isAgent: route.isAgent } }) as never,
      )

      expect(await route.verify(plain)).toEqual({ ok: false, error: 'invalid_token' })
    })

    it('最終利用が未記録なら自分のテーブルの行を更新する', async () => {
      findUnique().mockResolvedValue(fakeRow() as never)

      await route.verify(plain)

      expect(update()).toHaveBeenCalledWith({ where: { id: 'token-1' }, data: { lastUsedAt: expect.any(Date) } })
    })

    it('直近に使われていれば更新しない(リクエストごとの書き込みを避ける)', async () => {
      findUnique().mockResolvedValue(fakeRow({ lastUsedAt: new Date() }) as never)

      await route.verify(plain)

      expect(update()).not.toHaveBeenCalled()
    })

    it('前回の利用から間隔が空いていれば更新する', async () => {
      findUnique().mockResolvedValue(fakeRow({ lastUsedAt: new Date(Date.now() - 10 * 60 * 1000) }) as never)

      await route.verify(plain)

      expect(update()).toHaveBeenCalledTimes(1)
    })

    it('最終利用の記録に失敗しても認証は通す', async () => {
      findUnique().mockResolvedValue(fakeRow() as never)
      update().mockRejectedValue(new Error('db unavailable') as never)

      expect((await route.verify(plain)).ok).toBe(true)
    })
  })
})

describe('shouldRefreshLastUsed', () => {
  it('未記録なら書く', () => {
    expect(shouldRefreshLastUsed(null)).toBe(true)
  })

  it('5分以内なら書かず、それより古ければ書く', () => {
    expect(shouldRefreshLastUsed(new Date(Date.now() - 4 * 60 * 1000))).toBe(false)
    expect(shouldRefreshLastUsed(new Date(Date.now() - 6 * 60 * 1000))).toBe(true)
  })
})
