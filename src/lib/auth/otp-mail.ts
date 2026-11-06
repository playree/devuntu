import { after } from 'next/server'
import { logger } from '../logger'
import { sendEmailOtp } from '../mail'

/**
 * サインインの OTP メールをレスポンスの後に送る。
 *
 * 送信を待つと、宛先が実在するときだけ応答が遅れ、送信の失敗も実在するときだけ返るので、
 * アカウントの有無が分かってしまう。失敗はログにだけ残す。
 * リクエスト文脈の外(`after()` が使えない)ではその場で送る。
 */
export const sendEmailOtpAfterResponse = async (param: Parameters<typeof sendEmailOtp>[0]): Promise<void> => {
  const send = async () => {
    try {
      await sendEmailOtp(param)
    } catch (error) {
      logger.error({ error, to: param.to }, 'sendEmailOtp failed')
    }
  }
  try {
    after(send)
  } catch {
    await send()
  }
}
