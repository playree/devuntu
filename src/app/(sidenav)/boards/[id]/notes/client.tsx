'use client'

import { BoardNoteTypeChip, boardNoteTypeChip } from '@/components/board-note/board-note-chip'
import { AccordionSection } from '@/components/general/accordion'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { InputSearchField } from '@/components/general/input'
import { useModalState } from '@/components/general/modal'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { SingleSelectField } from '@/components/general/select'
import { TabsBox } from '@/components/general/tabs'
import { ContentHeader } from '@/components/header'
import {
  ArrowLeftCircleIcon,
  ArrowUturnLeftIcon,
  ClockIcon,
  Cog6ToothIcon,
  LightBulbIcon,
  PlusIcon,
  TrashIcon,
  ViewColumnsIcon,
} from '@/components/icon'
import { NoAccessView } from '@/components/no-access-view'
import { notify } from '@/components/notify'
import { ReloadButton } from '@/components/reload-button'
import { useBoardName } from '@/components/ticket/ticket-options'
import type { BoardNoteKind, BoardNoteType } from '@/generated/prisma/enums'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { BOARD_NOTE_KINDS } from '@/lib/board-note/board-note-rule'
import { dayformat } from '@/lib/day'
import { useConfirmAction } from '@/lib/use-confirm-action'
import { useLocale } from '@/locale/client'
import { Accordion, ButtonGroup, Chip } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC, useState } from 'react'
import { NoteHistoryModal, type HistoryTarget } from './note-history'
import { NoteDetailModal, NoteEditModal, type EditTarget } from './note-modals'
import { NoteUpdatedBy } from './note-updated-by'
import { getBoardNotes, getDeletedBoardNotes, restoreBoardNoteRevision, type GetBoardNotesReturnType } from './server'

type Page = NonNullable<GetBoardNotesReturnType>
type Note = Page['notes'][number]

const NoteRow: FC<{ note: Note; onOpen: () => void }> = ({ note, onOpen }) => (
  <button
    type='button'
    className='hover:bg-default/40 flex w-full flex-col items-start gap-1 rounded-xl border-2 px-3 py-2 text-left'
    onClick={onOpen}
  >
    <span className='flex w-full flex-wrap items-center gap-2'>
      <span className='font-mono text-sm font-medium break-all'>{note.name}</span>
      <BoardNoteTypeChip value={note.type} />
    </span>
    <span className='text-sm wrap-break-word'>{note.description}</span>
    <NoteUpdatedBy
      name={note.updatedBy?.name}
      isAgent={note.updatedBy?.isAgent}
      via={note.updatedVia}
      at={note.updatedAt}
    />
  </button>
)

/** 削除済みのノート。開いたときだけ取得する */
const DeletedNotes: FC<{
  boardId: string
  kind: BoardNoteKind
  canWrite: boolean
  onHistory: (target: HistoryTarget) => void
  onRestored: () => void
}> = ({ boardId, kind, canWrite, onHistory, onRestored }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const confirmAction = useConfirmAction()
  const { data, refresh, isLoading } = useActionData(() => getDeletedBoardNotes({ boardId, kind }))

  if (isLoading) {
    return <PanelSkeleton />
  }
  const list = data ?? []
  if (list.length === 0) {
    return <div className='text-muted px-1 text-sm'>{t('msg_no_deleted_board_notes')}</div>
  }

  const restore = (revision: (typeof list)[number]) =>
    confirmAction(
      { title: t('restore'), text: t('msg_confirm_restore_board_note', { target: revision.name }) },
      async () => {
        await parseAction(restoreBoardNoteRevision({ id: revision.id }))
        notify.success(t('msg_restored_target', { target: revision.name }))
        refresh()
        onRestored()
      },
    )

  return (
    <div className='space-y-1'>
      {list.map((revision) => (
        <div key={revision.id} className='flex items-start gap-2 rounded-xl border-2 border-dashed px-3 py-2'>
          <div className='min-w-0 grow space-y-1'>
            <div className='font-mono text-sm break-all'>{revision.name}</div>
            <div className='text-muted text-sm wrap-break-word'>{revision.description}</div>
            <div className='text-muted text-xs'>
              {t('msg_deleted_by', { name: revision.actorName || t('no_name') })}{' '}
              <span className='font-mono'>{dayformat(revision.createdAt, 'tz-minute', tz)}</span>
            </div>
          </div>
          <div className='flex shrink-0 items-center gap-0.5'>
            <MultiButton
              isIconOnly
              size='sm'
              variant='ghost'
              tooltip={t('history')}
              icon={<ClockIcon width={16} />}
              onPress={() => onHistory({ noteId: revision.noteId, name: revision.name })}
            />
            {canWrite && (
              <MultiButton
                isIconOnly
                size='sm'
                variant='ghost'
                tooltip={t('restore')}
                icon={<ArrowUturnLeftIcon width={16} />}
                onPress={() => restore(revision)}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

const NotePanel: FC<{
  page: Page
  kind: BoardNoteKind
  type: BoardNoteType | null
  onOpen: (note: Note) => void
  onAdd: () => void
  onHistory: (target: HistoryTarget) => void
  reload: () => void
}> = ({ page, kind, type, onOpen, onAdd, onHistory, reload }) => {
  const { t } = useLocale()
  const notes = page.notes.filter((note) => note.kind === kind && (!type || note.type === type))
  const count = page.counts[kind]
  const limit = page.limits[kind]

  return (
    <div className='space-y-2'>
      <div className='flex flex-wrap items-center gap-2'>
        {page.canWrite && (
          <MultiButton
            size='sm'
            variant='outline'
            icon={<PlusIcon width={16} />}
            isDisabled={count >= limit}
            onPress={onAdd}
          >
            {t('add_board_note', { kind: t(`board_note_kind_${kind}`) })}
          </MultiButton>
        )}
        <span className='text-muted ml-auto text-xs'>
          {t('msg_board_note_count', { count: `${count}`, max: `${limit}` })}
        </span>
      </div>

      {notes.length === 0 ? (
        <div className='text-muted flex items-center gap-1 px-1 text-sm'>
          <LightBulbIcon width={16} />
          {t('msg_no_board_notes')}
        </div>
      ) : (
        <div className='space-y-1'>
          {notes.map((note) => (
            <NoteRow key={note.id} note={note} onOpen={() => onOpen(note)} />
          ))}
        </div>
      )}

      <Accordion hideSeparator>
        <AccordionSection id='deleted' icon={<TrashIcon />} title={t('board_note_deleted')} isLazyBody>
          <DeletedNotes
            boardId={page.board.id}
            kind={kind}
            canWrite={page.canWrite}
            onHistory={onHistory}
            onRestored={reload}
          />
        </AccordionSection>
      </Accordion>
    </div>
  )
}

/**
 * ボードノート(ナレッジ / メモリ)。閲覧はメンバー全員、書き込みはメンバー(アーカイブ済みのボードは不可)。
 * AI が主に読み書きするもので、画面は確認・手直し・履歴からの復元のために置く。
 */
export const BoardNotesClient: FC<{ boardId: string }> = ({ boardId }) => {
  const { t } = useLocale()
  const router = useRouter()
  const boardName = useBoardName()
  const typeOptions = boardNoteTypeChip.useOptions()
  const [keyword, setKeyword] = useState('')
  const [type, setType] = useState<BoardNoteType | null>(null)
  const detailState = useModalState<string>()
  const editState = useModalState<EditTarget>()
  const historyState = useModalState<HistoryTarget>()

  const {
    data: page,
    reload,
    refresh,
    isLoading,
  } = useActionData(() => getBoardNotes({ boardId, keyword }), {
    key: keyword,
  })

  if (isLoading && !page) {
    return <PanelSkeleton />
  }
  if (!page) {
    return <NoAccessView icon={<LightBulbIcon />} title={t('board_notes')} backHref='/boards' />
  }

  return (
    <FlexCol>
      <ContentHeader icon={<LightBulbIcon />} title={boardName(page.board)}>
        <MultiButton
          isIconOnly
          tooltip={t('back')}
          icon={<ArrowLeftCircleIcon />}
          onPress={() => router.push('/boards')}
        />
        <MultiButton
          isIconOnly
          tooltip={t('kanban')}
          icon={<ViewColumnsIcon />}
          onPress={() => router.push(`/boards/${boardId}`)}
        >
          <ButtonGroup.Separator />
        </MultiButton>
        <MultiButton
          isIconOnly
          tooltip={t('board_settings')}
          icon={<Cog6ToothIcon />}
          onPress={() => router.push(`/boards/${boardId}/settings`)}
        >
          <ButtonGroup.Separator />
        </MultiButton>
        <ReloadButton onReload={reload} />
      </ContentHeader>

      <NoticePanel className='text-xs'>{t('msg_board_notes_desc')}</NoticePanel>

      {page.archived && (
        <div>
          <Chip variant='soft' color='warning' size='sm'>
            <Chip.Label>{t('archived')}</Chip.Label>
          </Chip>
        </div>
      )}

      <div className='grid grid-cols-12 gap-2'>
        <div className='col-span-12 md:col-span-8'>
          <InputSearchField
            isSmart
            aria-label={t('keyword')}
            defaultValue={keyword}
            maxLength={100}
            onSubmit={(value) => setKeyword(value.trim())}
            onClear={() => setKeyword('')}
          />
        </div>
        <div className='col-span-12 md:col-span-4'>
          <SingleSelectField
            isSmart
            isLabelHidden
            label={t('board_note_type')}
            groupOptions={typeOptions}
            placeholder={t('board_note_type_all')}
            isClearable
            value={type}
            onChange={(value) => setType(value as BoardNoteType | null)}
          />
        </div>
      </div>

      <TabsBox
        aria-label={t('board_notes')}
        variant='secondary'
        items={BOARD_NOTE_KINDS.map((kind) => ({
          id: kind,
          label: `${t(`board_note_kind_${kind}`)} (${page.notes.filter((note) => note.kind === kind).length})`,
          content: (
            <NotePanel
              page={page}
              kind={kind}
              type={type}
              onOpen={(note) => detailState.open(note.id)}
              onAdd={() => editState.open({ kind })}
              onHistory={(target) => historyState.open(target)}
              reload={refresh}
            />
          ),
        }))}
      />

      <NoteDetailModal
        key={detailState.key}
        state={detailState}
        canWrite={page.canWrite}
        onEdit={(note) => editState.open({ note })}
        onHistory={(target) => historyState.open(target)}
        reload={refresh}
      />
      <NoteEditModal key={editState.key} state={editState} boardId={boardId} reload={refresh} />
      <NoteHistoryModal key={historyState.key} state={historyState} canWrite={page.canWrite} reload={refresh} />
    </FlexCol>
  )
}
