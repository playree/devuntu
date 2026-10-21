'use client'

import { BoardNoteKindChip } from '@/components/board-note/board-note-chip'
import { MultiButton } from '@/components/general/button'
import { DialogModal, useModalState } from '@/components/general/modal'
import { PanelSkeleton } from '@/components/general/panel'
import { ArrowUturnLeftIcon, ClockIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { TextDiffView } from '@/components/text-diff-view'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { ticketShortPath } from '@/lib/board/ticket-id'
import { useConfirmAction } from '@/lib/use-confirm-action'
import { useLocale } from '@/locale/client'
import { cn } from '@heroui/react'
import Link from 'next/link'
import { FC, ReactNode, useState } from 'react'
import { NoteUpdatedBy } from './note-updated-by'
import { getBoardNoteRevisions, type GetBoardNoteRevisionsReturnType, restoreBoardNoteRevision } from './server'

export type HistoryTarget = { noteId: string; name: string }

type Revision = NonNullable<GetBoardNoteRevisionsReturnType>[number]

const FieldChange: FC<{ label: string; before: ReactNode; after: ReactNode }> = ({ label, before, after }) => (
  <div className='flex flex-wrap items-center gap-x-2 gap-y-1 text-sm'>
    <span className='text-muted w-full text-xs sm:w-24'>{label}</span>
    <span className='text-muted line-through'>{before}</span>
    <span className='text-muted'>→</span>
    <span>{after}</span>
  </div>
)

/** 1つ前(古い側)の版との違い。最初の版は本文をそのまま出す */
const RevisionDiff: FC<{ revision: Revision; previous: Revision | undefined }> = ({ revision, previous }) => {
  const { t } = useLocale()
  if (revision.action === 'deleted') {
    return <div className='text-muted text-sm'>{t('msg_board_note_deleted_revision')}</div>
  }
  if (!previous) {
    return (
      <pre className='border-border rounded-lg border px-2 py-1 font-mono text-xs break-all whitespace-pre-wrap'>
        {revision.content}
      </pre>
    )
  }
  const changes = [
    previous.kind !== revision.kind && (
      <FieldChange
        key='kind'
        label={t('board_note_kind')}
        before={<BoardNoteKindChip value={previous.kind} />}
        after={<BoardNoteKindChip value={revision.kind} />}
      />
    ),
    previous.name !== revision.name && (
      <FieldChange key='name' label={t('board_note_name')} before={previous.name} after={revision.name} />
    ),
    previous.description !== revision.description && (
      <FieldChange
        key='description'
        label={t('board_note_description')}
        before={previous.description}
        after={revision.description}
      />
    ),
  ].filter(Boolean)

  return (
    <div className='space-y-2'>
      {changes}
      {previous.content === revision.content ? (
        changes.length === 0 && <div className='text-muted text-sm'>{t('msg_board_note_no_change')}</div>
      ) : (
        <TextDiffView before={previous.content} after={revision.content} />
      )}
    </div>
  )
}

/**
 * ノートの履歴。左に版の一覧、右に選んだ版と1つ前の版の差分を出す(スマホでは上下)。
 * 最新の版は今の内容と同じなので、戻せるのはそれより前の版と削除の版(削除前の内容で作り直す)
 */
export const NoteHistoryModal: FC<{
  state: ReturnType<typeof useModalState<HistoryTarget>>
  canWrite: boolean
  reload: () => void
}> = ({ state, canWrite, reload }) => {
  const { t } = useLocale()
  const confirmAction = useConfirmAction()
  const target = state.target
  const [selected, setSelected] = useState(0)
  const { data, refresh, isLoading } = useActionData(() => getBoardNoteRevisions({ id: target?.noteId ?? '' }), {
    skip: !target,
    key: target?.noteId,
  })

  const revisions = data ?? []
  const revision = revisions.at(selected)
  const isRestorable = canWrite && revision && (selected > 0 || revision.action === 'deleted')

  const restore = (rev: Revision) =>
    confirmAction(
      { title: t('restore'), text: t('msg_confirm_restore_board_note', { target: rev.name }) },
      async () => {
        await parseAction(restoreBoardNoteRevision({ id: rev.id }))
        notify.success(t('msg_restored_target', { target: rev.name }))
        setSelected(0)
        refresh()
        reload()
      },
    )

  return (
    <DialogModal
      state={state}
      size='5xl'
      isDismissable
      title={{ text: `${t('history')}: ${target?.name ?? ''}`, icon: <ClockIcon /> }}
    >
      {isLoading ? (
        <PanelSkeleton />
      ) : revisions.length === 0 || !revision ? (
        <div className='text-muted text-sm'>{t('msg_no_board_note_revisions')}</div>
      ) : (
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
                  <div className='text-sm font-medium'>{t(`board_note_action_${rev.action}`)}</div>
                  <NoteUpdatedBy name={rev.actorName} isAgent={rev.actorIsAgent} via={rev.via} at={rev.createdAt} />
                </button>
              </li>
            ))}
          </ul>
          <div className='col-span-12 min-w-0 space-y-2 md:col-span-8'>
            <div className='flex flex-wrap items-center gap-2'>
              <span className='font-mono text-sm break-all'>{revision.name}</span>
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
                  {t('board_note_restore_this')}
                </MultiButton>
              )}
            </div>
            <RevisionDiff revision={revision} previous={revisions.at(selected + 1)} />
          </div>
        </div>
      )}
    </DialogModal>
  )
}
