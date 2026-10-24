/** 認証あり Action の入口の判定。Proxy を通らない Server Action でもサインインと 2FA を確かめる */

import { safeAuthAction } from '@/lib/action/action-server'
import { auth } from '@/lib/auth/auth'
import { requiresTwoFaSetup } from '@/lib/auth/two-fa'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock('@/lib/auth/auth', () => ({ auth: { api: { getSession: vi.fn() } } }))
vi.mock('@/lib/auth/two-fa', () => ({ requiresTwoFaSetup: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const session = (role = 'user') => ({ user: { id: 'u1', role, twoFactorEnabled: false }, session: { id: 's1' } })

const userAction = safeAuthAction.metadata({ actionName: 'test', role: 'user' }).action(async () => 'done')
const preTwoFaAction = safeAuthAction
  .metadata({ actionName: 'test', role: 'user', allowWithoutTwoFa: true })
  .action(async () => 'done')
const adminAction = safeAuthAction.metadata({ actionName: 'test', role: 'admin' }).action(async () => 'done')

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(auth.api.getSession).mockResolvedValue(session() as never)
  vi.mocked(requiresTwoFaSetup).mockReturnValue(false)
})

describe('safeAuthAction', () => {
  it('セッションが無ければ INVALID_SESSION', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never)
    expect((await userAction()).serverError?.errorType).toBe('INVALID_SESSION')
  })

  it('2FA の設定が済んでいなければ INVALID_SESSION', async () => {
    vi.mocked(requiresTwoFaSetup).mockReturnValue(true)
    const result = await userAction()
    expect(result.data).toBeUndefined()
    expect(result.serverError?.errorType).toBe('INVALID_SESSION')
  })

  it('allowWithoutTwoFa の Action は 2FA の設定前でも呼べる', async () => {
    vi.mocked(requiresTwoFaSetup).mockReturnValue(true)
    expect((await preTwoFaAction()).data).toBe('done')
  })

  it('2FA を満たしていれば実行する', async () => {
    expect((await userAction()).data).toBe('done')
  })

  it('管理者の Action は一般ユーザーを拒否する', async () => {
    expect((await adminAction()).serverError?.errorType).toBe('PERMISSION_DENIED')
    vi.mocked(auth.api.getSession).mockResolvedValue(session('admin') as never)
    expect((await adminAction()).data).toBe('done')
  })
})
