'use client'

import { FlexCol } from '@/components/general/flex'
import { PanelSkeleton } from '@/components/general/panel'
import { SwitchField } from '@/components/general/switch'
import { notify } from '@/components/notify'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { FC, useState } from 'react'
import { BoardGithub } from './board-github'
import { BoardGitlab } from './board-gitlab'
import { getBoardGit, setBoardCompleteOnPrMerge } from './server'

/**
 * ボードの Git 連携。provider(GitHub / GitLab)ごとの対応付けと、共通の「マージで完了」の設定。
 */
export const BoardGit: FC<{ boardId: string }> = ({ boardId }) => {
  const { t } = useLocale()
  const { data: git, isLoading, refresh } = useActionData(() => getBoardGit({ id: boardId }))
  const [isSwitching, setSwitching] = useState(false)

  if (isLoading) {
    return <PanelSkeleton />
  }
  if (!git) {
    return null
  }

  const switchCompleteOnPrMerge = async (completeOnPrMerge: boolean) => {
    setSwitching(true)
    try {
      await parseAction(setBoardCompleteOnPrMerge({ id: boardId, completeOnPrMerge }))
      notify.success(t('msg_saved'))
      await refresh()
    } catch {
      // エラー表示は parseAction 側で済んでいる
    } finally {
      setSwitching(false)
    }
  }

  return (
    <FlexCol>
      <span className='text-muted text-xs'>{t('msg_board_git_desc')}</span>
      <BoardGithub boardId={boardId} github={git.github} refresh={refresh} />
      {git.gitlab && <BoardGitlab boardId={boardId} gitlab={git.gitlab} refresh={refresh} />}

      <SwitchField
        id='complete-on-pr-merge'
        isSmart
        label={t('git_complete_on_pr_merge')}
        isSelected={git.completeOnPrMerge}
        isDisabled={isSwitching}
        onChange={switchCompleteOnPrMerge}
      />
      <span className='text-muted text-xs'>{t('msg_git_complete_on_pr_merge')}</span>
    </FlexCol>
  )
}
