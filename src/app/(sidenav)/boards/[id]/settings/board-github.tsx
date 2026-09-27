'use client'

import { MultiButton } from '@/components/general/button'
import { CopyableField } from '@/components/general/copyable-field'
import { FlexCol } from '@/components/general/flex'
import { InputField } from '@/components/general/input'
import { useConfirmModal, useModalState } from '@/components/general/modal'
import { NoticePanel } from '@/components/general/panel'
import { ArrowPathIcon, GithubIcon, PlusIcon, XMarkIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action/action-client'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { dayformat } from '@/lib/day'
import { normalizeGithubRepo } from '@/lib/github/github'
import { useLocale } from '@/locale/client'
import { FC, useState } from 'react'
import { IssuedTarget, IssuedTokenModal } from './board-git-token-modal'
import {
  addBoardGithubRepository,
  GetBoardGitReturnType,
  regenerateGithubSecret,
  removeBoardRepository,
} from './server'

type Github = NonNullable<GetBoardGitReturnType>['github']
type Repository = Github['repositories'][number]

const RepositoryItem: FC<{
  boardId: string
  repository: Repository
  refresh: () => Promise<void>
  onIssued: (target: IssuedTarget) => void
}> = ({ boardId, repository, refresh, onIssued }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const { confirmModal } = useConfirmModal()
  const [isRemoving, setRemoving] = useState(false)
  const [isRegenerating, setRegenerating] = useState(false)

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

  const regenerate = async () => {
    if (
      repository.hasSecret &&
      !(await confirmModal().confirm({
        title: t('github_regenerate_secret'),
        text: t('msg_github_regenerate_confirm'),
      }))
    ) {
      return
    }
    setRegenerating(true)
    try {
      const { token } = await parseAction(regenerateGithubSecret({ id: boardId, repositoryId: repository.id }))
      onIssued({ id: repository.id, repo: repository.repo, webhookUrl: repository.webhookUrl, token })
      await refresh()
    } catch {
      // エラー表示は parseAction 側で済んでいる
    } finally {
      setRegenerating(false)
    }
  }

  return (
    <li className='border-default-200 space-y-2 rounded-md border p-2'>
      <div className='flex items-center gap-2'>
        <span className='min-w-0 font-mono text-sm break-all'>{repository.repo}</span>
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
      </div>
      <CopyableField isSmart aria-label={t('git_webhook_url')} text={repository.webhookUrl} />
      <div className='flex flex-wrap items-center gap-2 text-xs'>
        {repository.hasSecret ? (
          <span className='text-muted'>
            {t('git_last_received')}:{' '}
            {repository.lastReceivedAt ? dayformat(repository.lastReceivedAt, 'tz-minute', tz) : '-'}
          </span>
        ) : (
          <span className='text-warning'>
            {t('github_secret_unset')}: {t('msg_github_secret_unset')}
          </span>
        )}
        <MultiButton
          size='sm'
          variant={repository.hasSecret ? 'ghost' : 'outline'}
          className='ml-auto'
          icon={<ArrowPathIcon width={16} />}
          isPending={isRegenerating}
          onPress={regenerate}
        >
          {t('github_regenerate_secret')}
        </MultiButton>
      </div>
    </li>
  )
}

/**
 * ボードの GitHub 連携(対応付けるリポジトリ)。
 * シークレットはリポジトリごとに違うので、リポジトリごとに Webhook URL を出し、シークレットもリポジトリごとに持つ。
 */
export const BoardGithub: FC<{ boardId: string; github: Github; refresh: () => Promise<void> }> = ({
  boardId,
  github,
  refresh,
}) => {
  const { t } = useLocale()
  const issuedModal = useModalState<IssuedTarget>()
  const [repo, setRepo] = useState('')
  const [isInvalid, setInvalid] = useState(false)
  const [isAdding, setAdding] = useState(false)

  const add = async () => {
    if (!normalizeGithubRepo(repo)) {
      setInvalid(true)
      return
    }
    setAdding(true)
    try {
      const added = await parseAction(addBoardGithubRepository({ id: boardId, repo }))
      setRepo('')
      await refresh()
      notify.success(t('msg_added_target', { target: added.repo }))
      if (!added.token) {
        // 登録済みならシークレットは作り直さない。作り直しは一覧から行ってもらう
        return
      }
      // 続けて GitHub 側で Webhook を作ってもらうので、URL とシークレットをそのまま見せる
      issuedModal.open({ id: added.id, repo: added.repo, webhookUrl: added.webhookUrl, token: added.token })
    } catch {
      // エラー表示は parseAction 側で済んでいる
    } finally {
      setAdding(false)
    }
  }

  return (
    <FlexCol>
      <div className='flex items-center gap-2 text-sm font-medium'>
        <GithubIcon width={16} />
        GitHub
      </div>
      <NoticePanel className='text-xs'>{t('msg_board_github_desc')}</NoticePanel>

      <FlexCol isSmart>
        <span className='text-sm'>{t('git_repositories')}</span>
        {github.repositories.length > 0 ? (
          <ul className='space-y-2'>
            {github.repositories.map((repository) => (
              <RepositoryItem
                key={repository.id}
                boardId={boardId}
                repository={repository}
                refresh={refresh}
                onIssued={issuedModal.open}
              />
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

      <IssuedTokenModal
        key={issuedModal.key}
        state={issuedModal}
        label={t('github_webhook_secret')}
        description={t('msg_github_secret_desc')}
      />
    </FlexCol>
  )
}
