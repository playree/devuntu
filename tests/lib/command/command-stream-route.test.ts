/**
 * 実行ログの SSE エンドポイントの単体テスト
 *
 * `src/proxy.ts` の matcher は `api/` を除外しているので、ここの認証・認可がそのまま境界になる。
 * 実行ログには実行結果がそのまま出るため、他人の実行を覗けないことを固定する。
 */

import { GET } from '@/app/api/command/runs/[id]/stream/route'
import { getServerSession } from '@/lib/auth/auth'
import { getCommandRun } from '@/lib/command/command-run'
import { consumeRateLimit } from '@/lib/rate-limit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/command/command-run', () => ({ getCommandRun: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ consumeRateLimit: vi.fn() }))
// ストリームの中身は command-stream.test.ts で見る。ここでは開くかどうかだけ
vi.mock('@/lib/command/command-stream', () => ({ buildLogStream: vi.fn(() => new ReadableStream()) }))

const { buildLogStream } = await import('@/lib/command/command-stream')

const runId = '01a09de4-f705-705d-b42a-4445f18838ea'

const call = (opts?: { headers?: Record<string, string>; query?: string }) =>
  GET(
    new Request(`http://localhost:3000/api/command/runs/${runId}/stream${opts?.query ?? ''}`, {
      headers: opts?.headers,
    }),
    { params: Promise.resolve({ id: runId }) },
  )

const setSession = (user: { id: string; role?: string | null } | null) => {
  vi.mocked(getServerSession).mockResolvedValue((user ? { user } : null) as never)
}

const setRun = (userId: string | null) => {
  vi.mocked(getCommandRun).mockResolvedValue({ id: runId, userId } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(consumeRateLimit).mockReturnValue(true)
  setSession({ id: 'user-1', role: null })
  setRun('user-1')
})

describe('GET /api/command/runs/[id]/stream', () => {
  it('実行者本人にはストリームを開く', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8')
    // gzip されると proxy がバッファリングして進捗が飛び飛びになる
    expect(res.headers.get('Cache-Control')).toBe('no-store, no-transform')
    // nginx / Apache のバッファリングを止める
    expect(res.headers.get('X-Accel-Buffering')).toBe('no')
  })

  it('未認証は 401', async () => {
    setSession(null)
    const res = await call()
    expect(res.status).toBe(401)
    expect(getCommandRun).not.toHaveBeenCalled()
  })

  it('他人の実行は 404(存在を漏らさない)', async () => {
    setRun('other-user')
    const res = await call()
    expect(res.status).toBe(404)
    expect(buildLogStream).not.toHaveBeenCalled()
  })

  it('存在しない実行も同じ 404', async () => {
    vi.mocked(getCommandRun).mockResolvedValue(null as never)
    const res = await call()
    expect(res.status).toBe(404)
  })

  it('管理者は他人の実行も見られる', async () => {
    setSession({ id: 'admin-1', role: 'admin' })
    setRun('other-user')
    const res = await call()
    expect(res.status).toBe(200)
  })

  it('レート制限を超えたら 429', async () => {
    // 接続の張り直しを繰り返されても DB を叩き続けない
    vi.mocked(consumeRateLimit).mockReturnValue(false)
    const res = await call()
    expect(res.status).toBe(429)
    expect(getCommandRun).not.toHaveBeenCalled()
  })
})

describe('再開位置', () => {
  it('Last-Event-ID を再開位置に使う', async () => {
    await call({ headers: { 'last-event-id': '42' } })
    expect(vi.mocked(buildLogStream).mock.calls[0][1]).toBe(42)
  })

  it('ヘッダが無ければ cursor クエリを使う(リロード直後)', async () => {
    await call({ query: '?cursor=7' })
    expect(vi.mocked(buildLogStream).mock.calls[0][1]).toBe(7)
  })

  it('Last-Event-ID がクエリより優先される', async () => {
    await call({ headers: { 'last-event-id': '42' }, query: '?cursor=7' })
    expect(vi.mocked(buildLogStream).mock.calls[0][1]).toBe(42)
  })

  it.each(['', 'abc', '-1', '1.5', '9007199254740993'])('壊れた値は先頭から (%s)', async (raw) => {
    // 全量が再送されるだけで、欠落も重複も起きない
    await call({ query: `?cursor=${raw}` })
    expect(vi.mocked(buildLogStream).mock.calls[0][1]).toBe(0)
  })
})
