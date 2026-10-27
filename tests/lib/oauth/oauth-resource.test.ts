/**
 * MCP 向け OAuth アクセストークン(JWT)の検証
 *
 * JWT は DB に行が無いので、クライアントの無効化や利用者による許可の取り消しは検証時の参照でしか効かない。
 * 署名検証は jose を差し替え、取り消し後・再許可後の旧トークンが通らないことを固定する。
 */

import { MCP_RESOURCE, MCP_SCOPE } from '@/lib/auth/mcp-scope'
import { verifyMcpAccessToken } from '@/lib/oauth/oauth-resource'
import { prisma } from '@/lib/prisma'
import { jwtVerify } from 'jose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('jose', () => ({ createRemoteJWKSet: vi.fn(), jwtVerify: vi.fn() }))
vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({ oauthClient: ['findUnique'], user: ['findUnique'] }),
)

const iat = 1_700_000_000
const user = { id: 'u1', name: '開発者', email: 'dev@example.com', role: null }

const givenPayload = (override: Record<string, unknown> = {}) => {
  vi.mocked(jwtVerify).mockResolvedValue({
    payload: { sub: user.id, azp: 'client-1', aud: MCP_RESOURCE, scope: MCP_SCOPE, iat, ...override },
  } as never)
}

/** 検証が select している形のクライアント行。oauthconsents は where を満たした同意だけが入る */
const givenClient = (override: Record<string, unknown> = {}) => {
  vi.mocked(prisma.oauthClient.findUnique).mockResolvedValue({
    disabled: false,
    skipConsent: false,
    oauthconsents: [{ id: 'consent-1' }],
    ...override,
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...user, banned: false } as never)
})

describe('verifyMcpAccessToken', () => {
  it('同意が残っていれば通す', async () => {
    givenPayload()
    givenClient()
    expect(await verifyMcpAccessToken('jwt')).toEqual({
      ok: true,
      auth: { user, scopes: [MCP_SCOPE], kind: 'oauth', clientId: 'client-1' },
    })
  })

  it('同意はトークンの iat 以前に作られたものに限って引く(再許可後に取り消し前のトークンを通さない)', async () => {
    givenPayload()
    givenClient()
    await verifyMcpAccessToken('jwt')
    expect(vi.mocked(prisma.oauthClient.findUnique).mock.calls[0][0]).toMatchObject({
      where: { clientId: 'client-1' },
      select: { oauthconsents: { where: { userId: user.id, createdAt: { lte: new Date(iat * 1000) } } } },
    })
  })

  it('許可を取り消した後(該当する同意が無い)は拒否する', async () => {
    givenPayload()
    givenClient({ oauthconsents: [] })
    expect(await verifyMcpAccessToken('jwt')).toEqual({ ok: false, error: 'invalid_token' })
  })

  it('skipConsent が未設定(null)のクライアントは同意を確認する', async () => {
    givenPayload()
    givenClient({ skipConsent: null, oauthconsents: [] })
    expect(await verifyMcpAccessToken('jwt')).toEqual({ ok: false, error: 'invalid_token' })
  })

  it('同意画面を省略するクライアントは同意行が無くても通す', async () => {
    givenPayload()
    givenClient({ skipConsent: true, oauthconsents: [] })
    expect(await verifyMcpAccessToken('jwt')).toMatchObject({ ok: true })
  })

  it('無効化したクライアントのトークンは拒否する', async () => {
    givenPayload()
    givenClient({ disabled: true })
    expect(await verifyMcpAccessToken('jwt')).toEqual({ ok: false, error: 'invalid_token' })
  })

  it('削除したクライアントのトークンは拒否する', async () => {
    givenPayload()
    vi.mocked(prisma.oauthClient.findUnique).mockResolvedValue(null)
    expect(await verifyMcpAccessToken('jwt')).toEqual({ ok: false, error: 'invalid_token' })
  })

  it('BAN されたユーザーのトークンは拒否する', async () => {
    givenPayload()
    givenClient()
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...user, banned: true } as never)
    expect(await verifyMcpAccessToken('jwt')).toEqual({ ok: false, error: 'invalid_token' })
  })

  it.each([
    ['iat', { iat: undefined }],
    ['sub', { sub: undefined }],
    ['azp', { azp: undefined }],
  ])('%s が無いトークンは DB を引かずに拒否する', async (_, override) => {
    givenPayload(override)
    expect(await verifyMcpAccessToken('jwt')).toEqual({ ok: false, error: 'invalid_token' })
    expect(prisma.oauthClient.findUnique).not.toHaveBeenCalled()
  })

  it('mcp スコープが無ければ insufficient_scope', async () => {
    givenPayload({ scope: 'openid' })
    expect(await verifyMcpAccessToken('jwt')).toEqual({ ok: false, error: 'insufficient_scope' })
  })

  it('署名検証に失敗したら invalid_token', async () => {
    vi.mocked(jwtVerify).mockRejectedValue(new Error('signature verification failed'))
    expect(await verifyMcpAccessToken('jwt')).toEqual({ ok: false, error: 'invalid_token' })
  })
})
