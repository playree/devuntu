'use client'

import { MultiButton } from '@/components/general/button'
import { CopyableField } from '@/components/general/copyable-field'
import { FlexCol } from '@/components/general/flex'
import { InputField } from '@/components/general/input'
import { FormModal, useConfirmModal, useModalState } from '@/components/general/modal'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { RadioField } from '@/components/general/radio'
import { SingleSelectField } from '@/components/general/select'
import { ArrowPathIcon, KeyIcon, PlusIcon, XMarkIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { GitWebhookAuthChip, useGitWebhookAuthOptions } from '@/components/ticket/ticket-link-chip'
import { type GitWebhookAuth } from '@/generated/prisma/enums'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { dayformat } from '@/lib/day'
import { GITLAB_SIGNING_TOKEN_PATTERN, gitlabInstanceLabel, normalizeGitlabProjectPath } from '@/lib/gitlab/gitlab'
import { useLocale } from '@/locale/client'
import { FC, useState } from 'react'
import { CompleteOnMergeSwitch } from './board-git'
import { IssuedTarget, IssuedTokenModal, WebhookTarget } from './board-git-token-modal'
import {
  addBoardGitlabRepository,
  getBoardGitlab,
  GetBoardGitlabReturnType,
  regenerateGitlabToken,
  removeBoardRepository,
  setGitlabSigningToken,
} from './server'

type Gitlab = NonNullable<GetBoardGitlabReturnType>
type Repository = Gitlab['repositories'][number]

/** 署名トークンの入力先。対応付けの直後にも、一覧の「署名トークンを設定」からも開く */
type SigningTarget = WebhookTarget

const SigningTokenModal: FC<{
  boardId: string
  state: ReturnType<typeof useModalState<SigningTarget>>
  refresh: () => Promise<void>
}> = ({ boardId, state, refresh }) => {
  const { t } = useLocale()
  const [secret, setSecret] = useState('')
  const [isInvalid, setInvalid] = useState(false)
  const [isSaving, setSaving] = useState(false)
  const target = state.target

  const save = async () => {
    if (!target) {
      return
    }
    const value = secret.trim()
    if (!GITLAB_SIGNING_TOKEN_PATTERN.test(value)) {
      setInvalid(true)
      return
    }
    setSaving(true)
    try {
      await parseAction(setGitlabSigningToken({ id: boardId, repositoryId: target.id, secret: value }))
      notify.success(t('msg_saved'))
      state.close()
      await refresh()
    } catch {
      // エラー表示は parseAction 側で済んでいる。貼り直さずに済むよう入力は残す
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormModal
      state={state}
      title={{ text: t('gitlab_set_signing_token'), icon: <KeyIcon /> }}
      onSubmit={async (e) => {
        e?.preventDefault()
        await save()
      }}
      submit={{ isPending: isSaving, isDisabled: !secret.trim() }}
    >
      {target && (
        <FlexCol>
          <span className='font-mono text-sm break-all'>{target.repo}</span>
          <CopyableField label={t('git_webhook_url')} text={target.webhookUrl} />
          <NoticePanel className='text-xs'>{t('msg_gitlab_signing_token_desc')}</NoticePanel>
          <InputField
            type='password'
            label={t('gitlab_signing_token')}
            placeholder='whsec_...'
            autoComplete='off'
            value={secret}
            onChange={(e) => {
              setSecret(e.target.value)
              setInvalid(false)
            }}
            errorMessage={isInvalid ? t('@invalid_gitlab_signing_token') : undefined}
          />
        </FlexCol>
      )}
    </FormModal>
  )
}

const RepositoryItem: FC<{
  boardId: string
  repository: Repository
  showInstance: boolean
  refresh: () => Promise<void>
  onSetSigningToken: (target: SigningTarget) => void
  onIssued: (target: IssuedTarget) => void
}> = ({ boardId, repository, showInstance, refresh, onSetSigningToken, onIssued }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const { confirmModal } = useConfirmModal()
  const [isRemoving, setRemoving] = useState(false)
  const [isRegenerating, setRegenerating] = useState(false)
  const target = { id: repository.id, repo: repository.repo, webhookUrl: repository.webhookUrl }

  const remove = async () => {
    if (
      !(await confirmModal().confirm({
        title: t('confirm_deletion'),
        text: t('msg_confirm_deletion', { target: repository.repo }),
      }))
    ) {
      return
    }
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
      !(await confirmModal().confirm({ title: t('gitlab_regenerate_token'), text: t('msg_gitlab_regenerate_confirm') }))
    ) {
      return
    }
    setRegenerating(true)
    try {
      const { token } = await parseAction(regenerateGitlabToken({ id: boardId, repositoryId: repository.id }))
      onIssued({ ...target, token })
      await refresh()
    } catch {
      // エラー表示は parseAction 側で済んでいる
    } finally {
      setRegenerating(false)
    }
  }

  return (
    <li className='border-default-200 space-y-2 rounded-md border p-2'>
      <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
        <span className='min-w-0 font-mono text-sm break-all'>
          {showInstance && <span className='text-muted'>{gitlabInstanceLabel(repository.baseUrl)}/</span>}
          {repository.repo}
        </span>
        <GitWebhookAuthChip value={repository.webhookAuth} />
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
            {t('gitlab_secret_unset')}: {t('msg_gitlab_secret_unset')}
          </span>
        )}
        <div className='ml-auto flex flex-wrap justify-end gap-2'>
          <MultiButton
            size='sm'
            variant={repository.webhookAuth === 'signing' ? 'outline' : 'ghost'}
            icon={<KeyIcon width={16} />}
            onPress={() => onSetSigningToken(target)}
          >
            {t('gitlab_set_signing_token')}
          </MultiButton>
          <MultiButton
            size='sm'
            variant={repository.webhookAuth === 'token' ? 'outline' : 'ghost'}
            icon={<ArrowPathIcon width={16} />}
            isPending={isRegenerating}
            onPress={regenerate}
          >
            {t('gitlab_regenerate_token')}
          </MultiButton>
        </div>
      </div>
    </li>
  )
}

/**
 * 対応付けるプロジェクト。
 * トークンは Webhook ごとに違うので、プロジェクトごとに Webhook URL を出し、トークンもプロジェクトごとに持つ。
 */
const GitlabRepositories: FC<{ boardId: string; gitlab: Gitlab; refresh: () => Promise<void> }> = ({
  boardId,
  gitlab,
  refresh,
}) => {
  const { t } = useLocale()
  const authOptions = useGitWebhookAuthOptions()
  const signingModal = useModalState<SigningTarget>()
  const issuedModal = useModalState<IssuedTarget>()
  const [baseUrl, setBaseUrl] = useState(gitlab.instances[0])
  const [project, setProject] = useState('')
  const [webhookAuth, setWebhookAuth] = useState<GitWebhookAuth>('signing')
  const [isInvalid, setInvalid] = useState(false)
  const [isAdding, setAdding] = useState(false)

  // 環境変数からインスタンスを外すと、残った対応付けのインスタンスが一覧に無くなる。区別できるよう名前を出す
  const showInstance =
    gitlab.instances.length > 1 || gitlab.repositories.some((repository) => repository.baseUrl !== baseUrl)

  const add = async () => {
    if (!normalizeGitlabProjectPath(project, baseUrl)) {
      setInvalid(true)
      return
    }
    setAdding(true)
    try {
      const added = await parseAction(addBoardGitlabRepository({ id: boardId, baseUrl, project, webhookAuth }))
      setProject('')
      await refresh()
      // 登録済みの対応付けは検証方式もトークンも変えない。切り替え・作り直しは一覧から行ってもらう
      if (added.isExisting && !(added.webhookAuth === 'signing' && webhookAuth === 'signing')) {
        notify.warn(t('msg_gitlab_already_added'))
        return
      }
      if (!added.isExisting) {
        notify.success(t('msg_added_target', { target: added.repo }))
      }
      // 続けて GitLab 側で Webhook を作ってもらうので、URL とトークンの入力 / 表示をそのまま開く
      const target = { id: added.id, repo: added.repo, webhookUrl: added.webhookUrl }
      if (added.token) {
        issuedModal.open({ ...target, token: added.token })
      } else {
        signingModal.open(target)
      }
    } catch {
      // エラー表示は parseAction 側で済んでいる
    } finally {
      setAdding(false)
    }
  }

  return (
    <FlexCol>
      {gitlab.enabled ? (
        <NoticePanel className='text-xs'>{t('msg_board_gitlab_desc')}</NoticePanel>
      ) : (
        <span className='text-warning text-xs'>{t('msg_git_provider_disabled')}</span>
      )}

      <FlexCol isSmart>
        <span className='text-sm'>{t('git_repositories')}</span>
        {gitlab.repositories.length > 0 ? (
          <ul className='space-y-2'>
            {gitlab.repositories.map((repository) => (
              <RepositoryItem
                key={repository.id}
                boardId={boardId}
                repository={repository}
                showInstance={showInstance}
                refresh={refresh}
                onSetSigningToken={signingModal.open}
                onIssued={issuedModal.open}
              />
            ))}
          </ul>
        ) : (
          <span className='text-muted text-sm'>-</span>
        )}

        {gitlab.enabled && (
          <form
            className='space-y-2'
            onSubmit={(e) => {
              e.preventDefault()
              void add()
            }}
          >
            {gitlab.instances.length > 1 && (
              <SingleSelectField
                isSmart
                label={t('gitlab_instance')}
                groupOptions={Object.fromEntries(gitlab.instances.map((url) => [url, gitlabInstanceLabel(url)]))}
                value={baseUrl}
                onChange={(value) => {
                  if (value) {
                    setBaseUrl(value)
                    setInvalid(false)
                  }
                }}
              />
            )}
            <RadioField
              isSmart
              orientation='horizontal'
              label={t('gitlab_webhook_auth')}
              options={Object.entries(authOptions).map(([value, label]) => ({ value, label }))}
              value={webhookAuth}
              onChange={(value) => setWebhookAuth(value as GitWebhookAuth)}
            />
            <div className='flex items-start gap-2'>
              <div className='grow'>
                <InputField
                  isSmart
                  isLabelHidden
                  label={t('gitlab_project')}
                  aria-label={t('gitlab_project')}
                  placeholder='group/project'
                  value={project}
                  onChange={(e) => {
                    setProject(e.target.value)
                    setInvalid(false)
                  }}
                  errorMessage={isInvalid ? t('@invalid_gitlab_project') : undefined}
                />
              </div>
              <MultiButton
                type='submit'
                size='sm'
                variant='outline'
                icon={<PlusIcon width={16} />}
                isPending={isAdding}
                isDisabled={!project.trim()}
              >
                {t('add_project')}
              </MultiButton>
            </div>
          </form>
        )}
      </FlexCol>

      <SigningTokenModal key={signingModal.key} boardId={boardId} state={signingModal} refresh={refresh} />
      <IssuedTokenModal
        key={issuedModal.key}
        state={issuedModal}
        label={t('gitlab_secret_token')}
        description={t('msg_gitlab_secret_token_desc')}
      />
    </FlexCol>
  )
}

/**
 * ボードの GitLab 連携(対応付けるプロジェクトとマージで完了の設定)。
 */
export const BoardGitlab: FC<{ boardId: string }> = ({ boardId }) => {
  const { t } = useLocale()
  const { data: gitlab, isLoading, refresh } = useActionData(() => getBoardGitlab({ id: boardId }))

  if (isLoading) {
    return <PanelSkeleton />
  }
  if (!gitlab) {
    return null
  }

  return (
    <FlexCol>
      <span className='text-muted text-xs'>{t('msg_board_git_desc')}</span>
      <GitlabRepositories boardId={boardId} gitlab={gitlab} refresh={refresh} />
      <CompleteOnMergeSwitch
        boardId={boardId}
        provider='gitlab'
        isSelected={gitlab.completeOnMerge}
        refresh={refresh}
      />
    </FlexCol>
  )
}
