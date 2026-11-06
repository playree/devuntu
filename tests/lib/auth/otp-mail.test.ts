import { sendEmailOtpAfterResponse } from '@/lib/auth/otp-mail'
import { logger } from '@/lib/logger'
import { sendEmailOtp } from '@/lib/mail'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ after: vi.fn() }))

vi.mock('next/server', () => ({ after: mocks.after }))
vi.mock('@/lib/mail', () => ({ sendEmailOtp: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const PARAM = { locale: 'ja', to: 'user@example.com', otp: '123456' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(sendEmailOtp).mockResolvedValue(undefined)
})

describe('sendEmailOtpAfterResponse', () => {
  it('レスポンスの後に送る(呼び出しの時点では送らない)', async () => {
    await sendEmailOtpAfterResponse(PARAM)

    expect(mocks.after).toHaveBeenCalledTimes(1)
    expect(sendEmailOtp).not.toHaveBeenCalled()

    await mocks.after.mock.calls[0][0]()
    expect(sendEmailOtp).toHaveBeenCalledWith(PARAM)
  })

  it('送信の失敗は投げずにログへ残す', async () => {
    vi.mocked(sendEmailOtp).mockRejectedValue(new Error('smtp down'))
    await sendEmailOtpAfterResponse(PARAM)

    await expect(mocks.after.mock.calls[0][0]()).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalled()
  })

  it('リクエスト文脈の外ではその場で送る', async () => {
    mocks.after.mockImplementationOnce(() => {
      throw new Error('outside request scope')
    })
    await sendEmailOtpAfterResponse(PARAM)

    expect(sendEmailOtp).toHaveBeenCalledWith(PARAM)
  })
})
