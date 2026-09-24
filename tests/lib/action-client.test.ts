/** parseAction は失敗を通知してから throw する。handled に渡した errorType だけは呼び出し側に任せる */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/notify', () => ({ notify: { error: vi.fn() } }))

import { parseAction, setActionErrorNotifier } from '@/lib/action/action-client'
import { ClientError } from '@/lib/error'

const clientError = (errorType: string) =>
  Promise.resolve({ serverError: { name: 'ClientError', errorType } as { name?: string; errorType: string } })

describe('parseAction', () => {
  const notifier = vi.fn()

  beforeEach(() => {
    notifier.mockReset()
    setActionErrorNotifier(notifier)
  })

  it('ClientError は通知して errorType 付きで throw する', async () => {
    const error = await parseAction(clientError('DUPLICATED_TAG_NAME'), { wait: 0 }).catch((e) => e)
    expect(error).toBeInstanceOf(ClientError)
    expect(error.errorType).toBe('DUPLICATED_TAG_NAME')
    expect(notifier).toHaveBeenCalledWith('DUPLICATED_TAG_NAME')
  })

  it('handled に含む errorType は通知しない', async () => {
    await expect(
      parseAction(clientError('DUPLICATED_TAG_NAME'), { wait: 0, handled: ['DUPLICATED_TAG_NAME'] }),
    ).rejects.toBeInstanceOf(ClientError)
    expect(notifier).not.toHaveBeenCalled()
  })

  it("handled: 'all' はすべての ClientError を通知しない", async () => {
    await expect(parseAction(clientError('NOT_FOUND'), { wait: 0, handled: 'all' })).rejects.toBeInstanceOf(ClientError)
    expect(notifier).not.toHaveBeenCalled()
  })

  it("システムエラーは handled: 'all' でも通知する", async () => {
    const res = Promise.resolve({ serverError: { errorType: 'SYSTEM_ERROR' } })
    await expect(parseAction(res, { wait: 0, handled: 'all' })).rejects.toThrow()
    expect(notifier).toHaveBeenCalledWith('SYSTEM_ERROR')
  })

  it('入力検証エラーは VALIDATION_ERROR として通知する', async () => {
    const res = Promise.resolve({ validationErrors: { name: ['required'] } })
    await expect(parseAction(res, { wait: 0 })).rejects.toThrow()
    expect(notifier).toHaveBeenCalledWith('VALIDATION_ERROR')
  })

  it('応答を受け取れなかった場合は SYSTEM_ERROR として通知する', async () => {
    const failure = new Error('network')
    await expect(parseAction(Promise.reject(failure), { wait: 0, handled: 'all' })).rejects.toBe(failure)
    expect(notifier).toHaveBeenCalledWith('SYSTEM_ERROR')
  })

  it('成功時は data を返し通知しない', async () => {
    await expect(parseAction(Promise.resolve({ data: { id: 'x' } }), { wait: 0 })).resolves.toEqual({ id: 'x' })
    expect(notifier).not.toHaveBeenCalled()
  })
})
