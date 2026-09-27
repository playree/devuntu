/**
 * ランナー向け軽量API の共通処理の単体テスト
 *
 * エージェント用トークン以外を検証前に弾くこと、検証 → レート制限 → 自動運用設定の順、
 * 応答をキャッシュさせないことを固定する。
 */

import { AGENT_TOKEN_PREFIX } from '@/lib/agent/agent'
import type { ResourceAuth } from '@/lib/oauth/oauth-resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyAgentToken: vi.fn(),
  consumeRateLimit: vi.fn(() => true),
  findAgentRunner: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/agent/agent-token', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agent/agent-token')>()),
  verifyAgentToken: mocks.verifyAgentToken,
}))
vi.mock('@/lib/rate-limit', () => ({ consumeRateLimit: mocks.consumeRateLimit }))
vi.mock('@/lib/agent/agent-runner', () => ({ findAgentRunner: mocks.findAgentRunner }))
vi.mock('@/lib/logger', () => ({ logger: mocks.logger }))

const { agentError, agentJson, authenticateRunner, readJsonBody } = await import('@/lib/agent/agent-api')

const TOKEN = `${AGENT_TOKEN_PREFIX}secret`

const auth: ResourceAuth = {
  user: { id: 'agent-1', name: 'エージェント', email: 'agent@example.com', role: 'user' },
  scopes: [],
  kind: 'agent',
  clientId: 'token-1',
}

const request = (authorization?: string) =>
  new Request('http://localhost/api/agent/poll', {
    headers: authorization === undefined ? {} : { authorization },
  })

/** 失敗時の応答のステータスと本文 */
const failure = async (result: Awaited<ReturnType<typeof authenticateRunner>>) => {
  if (result.ok) {
    throw new Error('認証が通ってしまった')
  }
  return { status: result.response.status, body: await result.response.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.verifyAgentToken.mockResolvedValue({ ok: true, auth })
  mocks.consumeRateLimit.mockReturnValue(true)
  mocks.findAgentRunner.mockResolvedValue(null)
})

describe('agentJson', () => {
  it('既定は 200 で、中間キャッシュに残さない', async () => {
    const response = agentJson({ a: 1 })

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ a: 1 })
  })

  it('ステータスを指定できる', () => {
    expect(agentJson({}, 202).status).toBe(202)
  })
})

describe('agentError', () => {
  it('エラー名を error に入れ、キャッシュさせない', async () => {
    const response = agentError(403, 'forbidden')

    expect(response.status).toBe(403)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ error: 'forbidden' })
  })
})

describe('authenticateRunner', () => {
  it.each([
    ['Authorization なし', undefined],
    ['Bearer 以外のスキーム', `Basic ${TOKEN}`],
    ['トークンが空', 'Bearer '],
    ['MCP トークン', 'Bearer devuntu_pat_secret'],
    ['OAuth のアクセストークン', 'Bearer eyJhbGciOiJSUzI1NiJ9.e30.sig'],
  ])('%sなら検証せずに 401 を返す', async (_, authorization) => {
    const result = await authenticateRunner(request(authorization))

    expect(await failure(result)).toEqual({ status: 401, body: { error: 'invalid_token' } })
    expect(mocks.verifyAgentToken).not.toHaveBeenCalled()
  })

  it('スキームの大文字小文字は問わない', async () => {
    const result = await authenticateRunner(request(`bearer ${TOKEN}`))

    expect(result.ok).toBe(true)
    expect(mocks.verifyAgentToken).toHaveBeenCalledWith(TOKEN)
  })

  it('検証に失敗したら、その理由で 401 を返しレート制限を数えない', async () => {
    mocks.verifyAgentToken.mockResolvedValue({ ok: false, error: 'insufficient_scope' })

    const result = await authenticateRunner(request(`Bearer ${TOKEN}`))

    expect(await failure(result)).toEqual({ status: 401, body: { error: 'insufficient_scope' } })
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled()
  })

  it('レート制限はユーザー単位で、1 分 30 回', async () => {
    await authenticateRunner(request(`Bearer ${TOKEN}`))

    expect(mocks.consumeRateLimit).toHaveBeenCalledWith('agent-api:agent-1', { limit: 30, windowMs: 60_000 })
  })

  it('レート制限に掛かったら 429 を返し、自動運用設定を引かない', async () => {
    mocks.consumeRateLimit.mockReturnValue(false)

    const result = await authenticateRunner(request(`Bearer ${TOKEN}`))

    expect(await failure(result)).toEqual({ status: 429, body: { error: 'too_many_requests' } })
    expect(mocks.findAgentRunner).not.toHaveBeenCalled()
    expect(mocks.logger.warn).toHaveBeenCalledWith({ userId: 'agent-1' }, 'agent api rate limited')
  })

  it('通れば認証情報と自動運用設定を返す', async () => {
    const runner = { userId: 'agent-1' }
    mocks.findAgentRunner.mockResolvedValue(runner)

    const result = await authenticateRunner(request(`Bearer ${TOKEN}`))

    expect(result).toEqual({ ok: true, ctx: { auth, runner } })
    expect(mocks.findAgentRunner).toHaveBeenCalledWith('agent-1')
  })

  it('自動運用が未設定なら runner は null', async () => {
    const result = await authenticateRunner(request(`Bearer ${TOKEN}`))

    expect(result).toEqual({ ok: true, ctx: { auth, runner: null } })
  })
})

describe('readJsonBody', () => {
  const post = (body?: string) => new Request('http://localhost/api/agent/report', { method: 'POST', body })

  it('JSON を読み取る', async () => {
    expect(await readJsonBody(post('{"a":1}'))).toEqual({ a: 1 })
  })

  it('本文なしは空オブジェクト', async () => {
    expect(await readJsonBody(post())).toEqual({})
  })

  it('壊れた JSON は空オブジェクト', async () => {
    expect(await readJsonBody(post('{broken'))).toEqual({})
  })

  it('JSON であればオブジェクト以外もそのまま返す', async () => {
    expect(await readJsonBody(post('[1,2]'))).toEqual([1, 2])
  })
})
