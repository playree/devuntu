'use client'

import { useConfirmModal } from '@/components/general/modal'
import { useLocale } from '@/locale/client'
import { useRouter } from 'next/navigation'
import { useCallback } from 'react'
import { makePath } from '../client-utils'
import { authClient } from './auth-client'
import { authConfig } from './auth-config'

/**
 * セッションの鮮度不足を受けて再認証へ誘導するフック。
 *
 * 確認を取ってからサインイン画面へ送り、認証後は元の画面へ戻す。
 * 戻ったあとの操作はやり直しになるため、呼び出し側は失敗した処理を続行しないこと。
 */
export const useReAuth = () => {
  const { t } = useLocale()
  const router = useRouter()
  const { confirmModal } = useConfirmModal()
  const { data: session } = authClient.useSession()

  return useCallback(async () => {
    try {
      const ok = await confirmModal().confirm({
        title: t('re_auth'),
        text: t('msg_re_auth'),
        autoClose: false,
      })
      if (ok) {
        router.push(
          makePath(authConfig.path.signIn, {
            cb: window.location.href,
            re: session?.user.email ?? '',
          }),
        )
      }
    } finally {
      confirmModal().close()
    }
  }, [confirmModal, router, session?.user.email, t])
}
