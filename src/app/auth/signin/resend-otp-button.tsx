'use client'

import { MultiButton } from '@/components/general/button'
import { ArrowPathIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { useLocale } from '@/locale/client'
import { FC } from 'react'

/**
 * 再送の結果。
 * - `expired`: 一時的な認証状態が有効期限切れ。サインインを最初からやり直す
 * - `failed` : それ以外の失敗(レート制限など)。通知だけ出して画面は維持する
 * - `null`   : 送る前提が揃っていない(何もしない)
 */
export type ResendOtpResult = 'sent' | 'expired' | 'failed' | null

/** OTP の再送ボタン */
export const ResendOtpButton: FC<{ send: () => Promise<ResendOtpResult> }> = ({ send }) => {
  const { t } = useLocale()
  return (
    <MultiButton
      variant='ghost'
      icon={<ArrowPathIcon />}
      coolTime={30}
      onPress={async () => {
        const result = await send()
        if (result === 'expired') {
          window.location.reload()
          return
        }
        if (result === 'failed') {
          notify.warn(t('auth_ng'))
          return
        }
        if (result === 'sent') {
          notify.success(t('msg_otp_sent'))
        }
      }}
    >
      {t('resend')}
    </MultiButton>
  )
}
