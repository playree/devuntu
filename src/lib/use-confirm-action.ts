'use client'

import { ConfirmParam, useConfirmModal } from '@/components/general/modal'
import { ClientError } from './error'

/**
 * 「確認 → 実行 → 閉じる」の定型処理をまとめたフック。
 * 確認モーダルは実行が終わるまで開いたまま(autoClose: false)にし、既定でチェック必須にする。
 * parseAction が通知済みの ClientError はここで止め、それ以外は呼び出し元へ投げ直す。
 */
export const useConfirmAction = () => {
  const { confirmModal } = useConfirmModal()

  return async (param: Omit<ConfirmParam, 'autoClose' | 'onlyOk'>, action: () => Promise<void>) => {
    try {
      const ok = await confirmModal().confirm({ requireCheck: true, ...param, autoClose: false })
      if (ok) {
        await action()
      }
    } catch (e) {
      if (!(e instanceof ClientError)) {
        throw e
      }
    } finally {
      confirmModal().close()
    }
  }
}
