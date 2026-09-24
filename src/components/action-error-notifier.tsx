'use client'

import { notify } from '@/components/notify'
import { setActionErrorNotifier } from '@/lib/action/action-client'
import { isReAuthRequired, resolveActionErrorMessage } from '@/lib/action/action-error'
import { useReAuth } from '@/lib/auth/use-re-auth'
import { useLocale } from '@/locale/client'
import { FC, useEffect, useRef } from 'react'

/**
 * parseAction の失敗通知を、翻訳済みの文言と再認証の誘導で行えるようにする。
 * 確認モーダルとロケールを使うため、それらの Provider の内側に置く。
 */
export const ActionErrorNotifier: FC = () => {
  const { t } = useLocale()
  const reAuth = useReAuth()
  // 連打などで再認証が重なると、確認モーダルが使用中で落ちるため1回に絞る
  const isReAuthingRef = useRef(false)

  useEffect(() => {
    setActionErrorNotifier((errorType) => {
      if (isReAuthRequired(errorType)) {
        if (isReAuthingRef.current) {
          return
        }
        isReAuthingRef.current = true
        reAuth()
          // 別の確認モーダルが使用中だと confirm が投げる。誘導できないだけなので記録に留める
          .catch(console.error)
          .finally(() => {
            isReAuthingRef.current = false
          })
        return
      }
      const { item, level } = resolveActionErrorMessage(errorType)
      if (level === 'warn') {
        notify.warn(t(item))
      } else {
        notify.error(t('error'), { description: t(item) })
      }
    })
    return () => setActionErrorNotifier(undefined)
  }, [reAuth, t])

  return null
}
