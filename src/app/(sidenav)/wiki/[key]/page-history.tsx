'use client'

import { MultiButton } from '@/components/general/button'
import { DialogModal, useModalState } from '@/components/general/modal'
import { PanelSkeleton } from '@/components/general/panel'
import { ArrowUturnLeftIcon, ClockIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { TextDiffView } from '@/components/text-diff-view'
import { UpdatedBy } from '@/components/updated-by'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { ticketShortPath } from '@/lib/board/ticket-id'
import { useConfirmAction } from '@/lib/use-confirm-action'
import type { WikiPageWriteResult } from '@/lib/wiki/wiki-page'
import { useLocale } from '@/locale/client'
import { Chip, cn } from '@heroui/react'
import Link from 'next/link'
import { FC, ReactNode, useState } from 'react'
import {
  getWikiPageRevisionDiff,
  getWikiPageRevisions,
  type GetWikiPageRevisionsReturnType,
  restoreWikiPageRevision,
} from './server'
import { useWikiSpace } from './space-context'

export type WikiHistoryTarget = { pageId: string; title: string }

type Revision = NonNullable<GetWikiPageRevisionsReturnType>['revisions'][number]

const FieldChange: FC<{ label: string; before: ReactNode; after: ReactNode }> = ({ label, before, after }) => (
  <div className='flex flex-wrap items-center gap-x-2 gap-y-1 text-sm'>
    <span className='text-muted w-full text-xs sm:w-24'>{label}</span>
    <span className='text-muted break-all line-through'>{before}</span>
    <span className='text-muted'>→</span>
    <span className='break-all'>{after}</span>
  </div>
)

/** 版の本文をそのまま出す。空の本文は枠ごと出さない */
const ContentView: FC<{ content: string }> = ({ content }) =>
  content && (
    <pre className='border-border rounded-lg border px-2 py-1 font-mono text-xs break-all whitespace-pre-wrap'>
      {content}
    </pre>
  )

/** 親ページの表示名。いまのツリーで引けなければ削除済み */
const useParentLabel = () => {
  const { t } = useLocale()
  const { space, tree } = useWikiSpace()
  return (parentId: string | null) =>
    parentId === null
      ? t('wiki_space_root', { name: space.name })
      : (tree.find(({ id }) => id === parentId)?.title ?? t('wiki_revision_parent_missing'))
}

/** 1つ前(古い側)の版との違い。本文は選んだときに引く。最初の版は本文をそのまま出す */
const RevisionDiff: FC<{ revision: Revision; previous: Revision | undefined }> = ({ revision, previous }) => {
  const { t } = useLocale()
  const parentLabel = useParentLabel()
  const { data, isLoading } = useActionData(() => getWikiPageRevisionDiff({ id: revision.id }), { key: revision.id })

  if (isLoading) {
    return <PanelSkeleton />
  }
  if (!data) {
    return null
  }
  if (revision.action === 'deleted') {
    return (
      <div className='space-y-2'>
        <div className='text-muted text-sm'>{t('msg_wiki_deleted_revision')}</div>
        <ContentView content={data.content} />
      </div>
    )
  }
  if (!previous || data.previousContent === null) {
    return <ContentView content={data.content} />
  }

  const beforeTags = previous.tagNames.join(', ')
  const afterTags = revision.tagNames.join(', ')
  const changes = [
    previous.title !== revision.title && (
      <FieldChange key='title' label={t('wiki_page_title')} before={previous.title} after={revision.title} />
    ),
    beforeTags !== afterTags && (
      <FieldChange key='tags' label={t('tags')} before={beforeTags || '-'} after={afterTags || '-'} />
    ),
    previous.parentId !== revision.parentId && (
      <FieldChange
        key='parent'
        label={t('wiki_revision_parent')}
        before={parentLabel(previous.parentId)}
        after={parentLabel(revision.parentId)}
      />
    ),
  ].filter(Boolean)

  return (
    <div className='space-y-2'>
      {changes}
      {data.previousContent === data.content ? (
        changes.length === 0 && <div className='text-muted text-sm'>{t('msg_wiki_no_revision_change')}</div>
      ) : (
        <TextDiffView before={data.previousContent} after={data.content} />
      )}
    </div>
  )
}

/**
 * ページの履歴。左に版の一覧、右に選んだ版と1つ前の版の差分を出す(スマホでは上下)。
 * 最新の版はいまの内容と同じなので、戻せるのはそれより前の版と削除の版(削除前の内容で作り直す)。
 * 存在するページはタイトル・本文・タグだけを戻し、位置は変えない
 */
export const WikiPageHistoryModal: FC<{
  state: ReturnType<typeof useModalState<WikiHistoryTarget>>
  canWrite: boolean
  onRestored: (result: WikiPageWriteResult) => void | Promise<void>
}> = ({ state, canWrite, onRestored }) => {
  const { t } = useLocale()
  const confirmAction = useConfirmAction()
  const target = state.target
  const [selected, setSelected] = useState(0)
  const { data, refresh, isLoading } = useActionData(() => getWikiPageRevisions({ id: target?.pageId ?? '' }), {
    skip: !target,
    key: target?.pageId,
  })

  const revisions = data?.revisions ?? []
  const revision = revisions.at(selected)
  const isDeletedPage = revisions.at(0)?.action === 'deleted'
  const isRestorable = canWrite && revision && (selected > 0 || revision.action === 'deleted')

  const restore = (rev: Revision) =>
    confirmAction(
      {
        title: t('restore'),
        text: t(isDeletedPage ? 'msg_confirm_restore_deleted_wiki_page' : 'msg_confirm_restore_wiki_page', {
          target: rev.title,
        }),
      },
      async () => {
        const result = await parseAction(restoreWikiPageRevision({ id: rev.id }))
        notify.success(t('msg_restored_target', { target: rev.title }))
        setSelected(0)
        await Promise.all([refresh(), onRestored(result)])
      },
    )

  return (
    <DialogModal
      state={state}
      size='5xl'
      isDismissable
      title={{ text: `${t('history')}: ${target?.title ?? ''}`, icon: <ClockIcon /> }}
    >
      {isLoading ? (
        <PanelSkeleton />
      ) : revisions.length === 0 || !revision ? (
        <div className='text-muted text-sm'>{t('msg_no_wiki_revisions')}</div>
      ) : (
        <div className='space-y-3'>
          <p className='text-muted text-xs'>{t('msg_wiki_revision_retention', { days: data?.retentionDays ?? '-' })}</p>
          <div className='grid grid-cols-12 gap-3'>
            <ul className='col-span-12 max-h-48 space-y-1 overflow-y-auto md:col-span-4 md:max-h-[60vh]'>
              {revisions.map((rev, index) => (
                <li key={rev.id}>
                  <button
                    type='button'
                    className={cn(
                      'hover:bg-default/40 w-full space-y-0.5 rounded-lg border px-2 py-1 text-left',
                      index === selected ? 'border-accent' : 'border-border',
                    )}
                    onClick={() => setSelected(index)}
                  >
                    <div className='flex flex-wrap items-center gap-2 text-sm font-medium'>
                      {t(`wiki_revision_action_${rev.action}`)}
                      {rev.beforeRetention && (
                        <Chip color='warning' variant='soft' size='sm'>
                          <Chip.Label>{t('wiki_revision_before_retention')}</Chip.Label>
                        </Chip>
                      )}
                    </div>
                    <UpdatedBy name={rev.actorName} isAgent={rev.actorIsAgent} via={rev.via} at={rev.updatedAt} />
                  </button>
                </li>
              ))}
            </ul>
            <div className='col-span-12 min-w-0 space-y-2 md:col-span-8'>
              <div className='flex flex-wrap items-center gap-2'>
                <span className='text-sm font-medium break-all'>{revision.title}</span>
                {revision.ticketDisplayId && (
                  <Link className='text-accent text-xs' href={ticketShortPath(revision.ticketDisplayId)}>
                    {revision.ticketDisplayId}
                  </Link>
                )}
                {isRestorable && (
                  <MultiButton
                    className='ml-auto'
                    size='sm'
                    variant='outline'
                    icon={<ArrowUturnLeftIcon width={16} />}
                    onPress={() => restore(revision)}
                  >
                    {t('wiki_restore_this')}
                  </MultiButton>
                )}
              </div>
              <RevisionDiff key={revision.id} revision={revision} previous={revisions.at(selected + 1)} />
            </div>
          </div>
        </div>
      )}
    </DialogModal>
  )
}
