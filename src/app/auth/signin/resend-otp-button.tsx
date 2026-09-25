'use client'

import { MultiButton } from '@/components/general/button'
import { ArrowPathIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { useLocale } from '@/locale/client'
import { FC } from 'react'

/**
 * OTP の再送ボタン。
 * `send` が false を返したら一時的な認証状態が有効期限切れなので、サインインを最初からやり直す。
 * null は送る前提が揃っていない(何もしない)。
 */
export const ResendOtpButton: FC<{ send: () => Promise<boolean | null> }> = ({ send }) => {
  const { t } = useLocale()
  return (
    <MultiButton
      variant='ghost'
      icon={<ArrowPathIcon />}
      coolTime={30}
      onPress={async () => {
        const sent = await send()
        if (sent === null) {
          return
        }
        if (!sent) {
          window.location.reload()
          return
        }
        notify.success(t('msg_otp_sent'))
      }}
    >
      {t('resend')}
    </MultiButton>
  )
}
