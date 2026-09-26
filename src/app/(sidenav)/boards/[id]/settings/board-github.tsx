'use client'

import { MultiButton } from '@/components/general/button'
import { CopyableField } from '@/components/general/copyable-field'
import { FlexCol } from '@/components/general/flex'
import { InputField } from '@/components/general/input'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { SwitchField } from '@/components/general/switch'
import { PlusIcon, XMarkIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { normalizeGithubRepo } from '@/lib/github/github'
import { useLocale } from '@/locale/client'
import { FC, useState } from 'react'
import {
  addBoardRepository,
  getBoardGithub,
  GetBoardGithubReturnType,
  removeBoardRepository,
  setBoardCompleteOnPrMerge,
} from './server'

type Repository = NonNullable<GetBoardGithubReturnType>['repositories'][number]

const RepositoryItem: FC<{ boardId: string; repository: Repository; refresh: () => Promise<void> }> = ({
  boardId,
  repository,
  refresh,
}) => {
  const { t } = useLocale()
  const [isRemoving, setRemoving] = useState(false)

  const remove = async () => {
    setRemoving(true)
    try {
      await parseAction(removeBoardRepository({ id: boardId, repositoryId: repository.id }))
      notify.success(t('msg_deleted_target', { target: repository.repo }))
      await refresh()
    } catch {
      // エラー表示は parseAction 側で済んでいる
    } finally {
      setRemoving(false)
    }
  }

  return (
    <li className='flex items-center gap-2'>
      <span className='min-w-0 truncate font-mono text-sm'>{repository.repo}</span>
      <MultiButton
        isIconOnly
        size='sm'
        variant='ghost'
        className='ml-auto'
        tooltip={t('delete')}
        icon={<XMarkIcon width={16} />}
        isPending={isRemoving}
        onPress={remove}
      />
    </li>
  )
}

/**
 * ボードの GitHub 連携(対応付けるリポジトリ・マージで完了)。
 * Webhook は GitHub 側で登録するので、登録先の URL と手順もここで案内する。
 */
export const BoardGithub: FC<{ boardId: string }> = ({ boardId }) => {
  const { t } = useLocale()
  const { data: github, isLoading, refresh } = useActionData(() => getBoardGithub({ id: boardId }))
  const [repo, setRepo] = useState('')
  const [isInvalid, setInvalid] = useState(false)
  const [isAdding, setAdding] = useState(false)
  const [isSwitching, setSwitching] = useState(false)

  if (isLoading) {
    return <PanelSkeleton />
  }
  if (!github) {
    return null
  }

  const add = async () => {
    if (!normalizeGithubRepo(repo)) {
      setInvalid(true)
      return
    }
    setAdding(true)
    try {
      const { repo: added } = await parseAction(addBoardRepository({ id: boardId, repo }))
      notify.success(t('msg_added_target', { target: added }))
      setRepo('')
      await refresh()
    } catch {
      // エラー表示は parseAction 側で済んでいる
    } finally {
      setAdding(false)
    }
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
      <NoticePanel className='text-xs'>{t('msg_board_github_desc')}</NoticePanel>
      <CopyableField isSmart label={t('github_webhook_url')} text={github.webhookUrl} />

      <FlexCol isSmart>
        <span className='text-sm'>{t('github_repositories')}</span>
        {github.repositories.length > 0 ? (
          <ul className='space-y-1'>
            {github.repositories.map((repository) => (
              <RepositoryItem key={repository.id} boardId={boardId} repository={repository} refresh={refresh} />
            ))}
          </ul>
        ) : (
          <span className='text-muted text-sm'>-</span>
        )}
        <form
          className='flex items-start gap-2'
          onSubmit={(e) => {
            e.preventDefault()
            void add()
          }}
        >
          <div className='grow'>
            <InputField
              isSmart
              isLabelHidden
              label={t('github_repository')}
              aria-label={t('github_repository')}
              placeholder='owner/repo'
              value={repo}
              onChange={(e) => {
                setRepo(e.target.value)
                setInvalid(false)
              }}
              errorMessage={isInvalid ? t('@invalid_github_repo') : undefined}
            />
          </div>
          <MultiButton
            type='submit'
            size='sm'
            variant='outline'
            icon={<PlusIcon width={16} />}
            isPending={isAdding}
            isDisabled={!repo.trim()}
          >
            {t('add_repository')}
          </MultiButton>
        </form>
      </FlexCol>

      <SwitchField
        id='complete-on-pr-merge'
        isSmart
        label={t('github_complete_on_pr_merge')}
        isSelected={github.completeOnPrMerge}
        isDisabled={isSwitching}
        onChange={switchCompleteOnPrMerge}
      />
      <span className='text-muted text-xs'>{t('msg_github_complete_on_pr_merge')}</span>
    </FlexCol>
  )
}
