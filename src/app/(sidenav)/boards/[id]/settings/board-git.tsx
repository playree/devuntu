'use client'

import { SwitchField } from '@/components/general/switch'
import { notify } from '@/components/notify'
import type { GitProvider } from '@/generated/prisma/enums'
import { parseAction } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { FC, useState } from 'react'
import { setBoardCompleteOnPrMerge } from './server'

/**
 * provider(GitHub / GitLab)ごとの「マージで完了」の切り替え。
 */
export const CompleteOnMergeSwitch: FC<{
  boardId: string
  provider: GitProvider
  isSelected: boolean
  refresh: () => Promise<void>
}> = ({ boardId, provider, isSelected, refresh }) => {
  const { t } = useLocale()
  const [isSwitching, setSwitching] = useState(false)

  const switchCompleteOnMerge = async (completeOnMerge: boolean) => {
    setSwitching(true)
    try {
      await parseAction(setBoardCompleteOnPrMerge({ id: boardId, provider, completeOnMerge }))
      notify.success(t('msg_saved'))
      await refresh()
    } catch {
      // エラー表示は parseAction 側で済んでいる
    } finally {
      setSwitching(false)
    }
  }

  return (
    <>
      <SwitchField
        id={`complete-on-${provider}-merge`}
        isSmart
        label={t(provider === 'github' ? 'github_complete_on_merge' : 'gitlab_complete_on_merge')}
        isSelected={isSelected}
        isDisabled={isSwitching}
        onChange={switchCompleteOnMerge}
      />
      <span className='text-muted text-xs'>{t('msg_git_complete_on_pr_merge')}</span>
    </>
  )
}
