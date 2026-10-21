'use client'

import {
  BoardNoteKindChip,
  boardNoteKindChip,
  BoardNoteTypeChip,
  boardNoteTypeChip,
} from '@/components/board-note/board-note-chip'
import { MultiButton } from '@/components/general/button'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input'
import { DialogModal, FormModal, useModalState } from '@/components/general/modal'
import { PanelSkeleton } from '@/components/general/panel'
import { SingleSelectCtrl } from '@/components/general/select'
import {
  ArrowDownCircleIcon,
  ArrowUpCircleIcon,
  ClockIcon,
  LightBulbIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
} from '@/components/icon'
import { MarkdownCtrl } from '@/components/markdown/markdown-editor'
import { MarkdownView } from '@/components/markdown/markdown-view'
import { notify } from '@/components/notify'
import type { BoardNoteKind } from '@/generated/prisma/enums'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { DEFAULT_BOARD_NOTE_TYPE } from '@/lib/board-note/board-note-rule'
import { type BoardNoteFields, scBoardNoteFields } from '@/lib/schema/schema-board-note'
import { useConfirmAction } from '@/lib/use-confirm-action'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import type { HistoryTarget } from './note-history'
import { NoteUpdatedBy } from './note-updated-by'
import {
  createBoardNote,
  deleteBoardNote,
  getBoardNote,
  type GetBoardNoteReturnType,
  moveBoardNote,
  updateBoardNote,
} from './server'

type NoteDetail = NonNullable<GetBoardNoteReturnType>

/** 追加(区分だけ決まっている)か編集(読み込んだノート) */
export type EditTarget = { kind: BoardNoteKind; note?: never } | { note: NoteDetail; kind?: never }

/** 詳細。編集・昇格 / 降格・履歴・削除の入口を兼ねる */
export const NoteDetailModal: FC<{
  state: ReturnType<typeof useModalState<string>>
  canWrite: boolean
  onEdit: (note: NoteDetail) => void
  onHistory: (target: HistoryTarget) => void
  reload: () => void
}> = ({ state, canWrite, onEdit, onHistory, reload }) => {
  const { t } = useLocale()
  const confirmAction = useConfirmAction()
  const id = state.target
  const { data: note, refresh, isLoading } = useActionData(() => getBoardNote({ id: id ?? '' }), { skip: !id, key: id })

  const move = async (target: NoteDetail) => {
    const kind = target.kind === 'memory' ? 'knowledge' : 'memory'
    await parseAction(moveBoardNote({ id: target.id, kind }))
    notify.success(t('msg_moved_board_note', { target: target.name, kind: t(`board_note_kind_${kind}`) }))
    refresh()
    reload()
  }

  const remove = (target: NoteDetail) =>
    confirmAction(
      { title: t('confirm_deletion'), text: t('msg_confirm_deletion', { target: target.name }) },
      async () => {
        await parseAction(deleteBoardNote({ id: target.id }))
        notify.success(t('msg_deleted_target', { target: target.name }))
        reload()
        state.close()
      },
    )

  return (
    <DialogModal
      state={state}
      size='3xl'
      isDismissable
      title={{ text: note?.name ?? '', icon: <LightBulbIcon /> }}
      headerEnd={
        note && (
          <div className='flex items-center gap-0.5'>
            <MultiButton
              isIconOnly
              size='sm'
              variant='ghost'
              tooltip={t('history')}
              icon={<ClockIcon width={16} />}
              onPress={() => onHistory({ noteId: note.id, name: note.name })}
            />
            {canWrite && (
              <>
                <MultiButton
                  isIconOnly
                  size='sm'
                  variant='ghost'
                  tooltip={t(note.kind === 'memory' ? 'board_note_promote' : 'board_note_demote')}
                  icon={note.kind === 'memory' ? <ArrowUpCircleIcon width={16} /> : <ArrowDownCircleIcon width={16} />}
                  onPress={() => move(note)}
                />
                <MultiButton
                  isIconOnly
                  size='sm'
                  variant='ghost'
                  tooltip={t('update')}
                  icon={<PencilSquareIcon width={16} />}
                  onPress={() => onEdit(note)}
                />
                <MultiButton
                  isIconOnly
                  size='sm'
                  variant='ghost'
                  tooltip={t('delete')}
                  icon={<TrashIcon width={16} />}
                  onPress={() => remove(note)}
                />
              </>
            )}
          </div>
        )
      }
    >
      {isLoading || !note ? (
        <PanelSkeleton />
      ) : (
        <div className='space-y-3'>
          <div className='flex flex-wrap items-center gap-2'>
            <BoardNoteKindChip value={note.kind} />
            <BoardNoteTypeChip value={note.type} />
          </div>
          <div className='text-sm wrap-break-word'>{note.description}</div>
          <MarkdownView body={note.content} className='border-border rounded-lg border px-3 py-2' />
          <NoteUpdatedBy
            name={note.updatedBy?.name}
            isAgent={note.updatedBy?.isAgent}
            via={note.updatedVia}
            at={note.updatedAt}
          />
        </div>
      )}
    </DialogModal>
  )
}

/** 追加 / 編集。編集は開いた時点の更新日時を渡し、他の人の保存を上書きしないようにする */
export const NoteEditModal: FC<{
  state: ReturnType<typeof useModalState<EditTarget>>
  boardId: string
  reload: () => void
}> = ({ state, boardId, reload }) => {
  const { t, fet } = useLocale()
  const kindOptions = boardNoteKindChip.useOptions()
  const typeOptions = boardNoteTypeChip.useOptions()
  const note = state.target?.note

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<BoardNoteFields>({
    resolver: zodResolver(scBoardNoteFields),
    mode: 'onChange',
    defaultValues: {
      kind: note?.kind ?? state.target?.kind ?? 'memory',
      type: note?.type ?? DEFAULT_BOARD_NOTE_TYPE,
      name: note?.name ?? '',
      description: note?.description ?? '',
      content: note?.content ?? '',
    },
  })

  return (
    <FormModal
      state={state}
      size='5xl'
      onSubmit={handleSubmit(async (fields) => {
        const res = await parseAction(
          note
            ? updateBoardNote({ id: note.id, baseUpdatedAt: new Date(note.updatedAt).toISOString(), fields })
            : createBoardNote({ boardId, fields }),
        )
        notify.success(t(note ? 'msg_updated_target' : 'msg_added_target', { target: res.name }))
        reload()
        state.close()
      })}
      title={{
        text: note
          ? t('update_board_note', { kind: t(`board_note_kind_${note.kind}`) })
          : t('add_board_note', { kind: t(`board_note_kind_${state.target?.kind ?? 'memory'}`) }),
        icon: note ? <PencilSquareIcon /> : <PlusIcon />,
      }}
      submit={{ isPending: isSubmitting }}
    >
      <GridBox isSmart>
        <div className='col-span-12 md:col-span-6'>
          <InputCtrl
            control={control}
            name='name'
            constraintSchema={scBoardNoteFields}
            label={t('board_note_name')}
            errorMessage={fet(errors.name)}
            autoFocus
          />
        </div>
        <div className='col-span-6 md:col-span-3'>
          <SingleSelectCtrl control={control} name='kind' groupOptions={kindOptions} label={t('board_note_kind')} />
        </div>
        <div className='col-span-6 md:col-span-3'>
          <SingleSelectCtrl control={control} name='type' groupOptions={typeOptions} label={t('board_note_type')} />
        </div>
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            name='description'
            constraintSchema={scBoardNoteFields}
            label={t('board_note_description')}
            errorMessage={fet(errors.description)}
          />
        </div>
        <div className='col-span-12'>
          <MarkdownCtrl
            control={control}
            name='content'
            constraintSchema={scBoardNoteFields}
            errorMessage={fet(errors.content)}
          />
        </div>
      </GridBox>
    </FormModal>
  )
}
