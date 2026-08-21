'use client'

import { MultiButton } from '@/components/general/button'
import { CopyableField } from '@/components/general/copyable-field'
import { DatePickerField } from '@/components/general/date-picker'
import { FlexCol } from '@/components/general/flex'
import { Grid } from '@/components/general/grid'
import { InputField } from '@/components/general/input'
import { useConfirmModal } from '@/components/general/modal'
import { NoticePanel, Panel, PanelSkeleton } from '@/components/general/panel'
import { SingleSelectField } from '@/components/general/select'
import { ContentHeader } from '@/components/header'
import {
  ArrowLeftCircleIcon,
  CheckIcon,
  PencilSquareIcon,
  TicketIcon,
  TrashIcon,
  ViewColumnsIcon,
  XMarkIcon,
} from '@/components/icon'
import { MarkdownField } from '@/components/markdown/markdown-editor'
import { MentionCandidate } from '@/components/markdown/mention-menu'
import { notify } from '@/components/notify'
import { AssigneeSelectField } from '@/components/ticket/assignee-select'
import { MentionChips } from '@/components/ticket/mention-chips'
import { TagIdSelectField } from '@/components/ticket/tag-select'
import { PriorityChip, StatusChip, TagChips, useBoardName, useTicketOptions } from '@/components/ticket/ticket-chip'
import type { TicketStatus } from '@/generated/prisma/enums'
import { parseAction, useActionData } from '@/lib/action-client'
import { dayformat, utcToDateOnly } from '@/lib/day'
import { PatchTicketIn, scPatchTicket, zTicketTitle } from '@/lib/schema'
import { getFieldConstraints } from '@/lib/schema-util'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { Breadcrumbs } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC, useEffect, useState } from 'react'
import {
  createTicketTag,
  deleteTicket,
  getAssigneeOptions,
  getTicketFormOptions,
  GetTicketFormOptionsReturnType,
} from '../server'
import { TicketComments } from './comments'
import { getTicket, patchTicket, updateTicketStatus } from './server'

/** 内容の文字数上限(MDXEditor には maxLength 属性が無いのでスキーマから取る) */
const MAX_CONTENT_LENGTH = getFieldConstraints(scPatchTicket, 'content').maxLength

/** 保存中の項目。同時に複数の項目は保存させない */
type EditField = 'title' | 'status' | 'priority' | 'assigneeId' | 'dueDate' | 'tagIds'

/** 保存中の楽観値。status は patchTicket の対象外なので別枠で持つ */
type Draft = Partial<PatchTicketIn> & { status?: TicketStatus }

/**
 * 編集できない項目の 1 セル。
 * 入力欄(isSmart)と同じ体裁でラベル + 値を縦に並べ、編集できる項目と縦位置を揃える。
 * ラベルは isSmart 時の Label、値側の min-h-7 は isSmart 時の入力欄の高さ(28px)に合わせている。
 */
const MetaText: FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className='flex flex-col'>
    <span className='text-xs font-light'>{label}</span>
    <div className='flex min-h-7 items-center gap-2 text-sm'>{children}</div>
  </div>
)

/**
 * ヘッダの閉じるボタン。
 * 一覧に埋め込んだとき(onClose あり)はパネルを閉じる操作、単独ページでは一覧へ戻る操作になる。
 */
const CloseButton: FC<{ onClose?: () => void; onPress: () => void }> = ({ onClose, onPress }) => {
  const { t } = useLocale()
  return (
    <MultiButton isIconOnly variant='ghost' tooltip={onClose ? t('close') : t('back')} onPress={onPress}>
      {onClose ? <XMarkIcon /> : <ArrowLeftCircleIcon />}
    </MultiButton>
  )
}

/**
 * ヘッダのパンくず。ボード名 > 件名 の 2 階層。
 * 長い名前は幅で省略する。最後の項目(件名)は react-aria が現在地として扱うためリンクにならない。
 */
const TicketBreadcrumbs: FC<{ boardId: string; boardName: string; title: string }> = ({
  boardId,
  boardName,
  title,
}) => {
  const router = useRouter()
  return (
    <Breadcrumbs className='min-w-0'>
      <Breadcrumbs.Item // RouterProvider を置いていないため href ではなく router.push で遷移する
        onPress={() => router.push(`/boards/${boardId}`)}
      >
        <span className='flex items-center gap-1'>
          <ViewColumnsIcon width={16} />
          <span className='max-w-32 truncate sm:max-w-48'>{boardName}</span>
        </span>
      </Breadcrumbs.Item>
      <Breadcrumbs.Item>
        <span className='flex items-center gap-1'>
          <TicketIcon width={16} />
          <span className='max-w-40 truncate sm:max-w-72'>{title}</span>
        </span>
      </Breadcrumbs.Item>
    </Breadcrumbs>
  )
}

export const TicketDetailClient: FC<{
  id: string
  /** 一覧に埋め込んだときの閉じる操作。未指定なら一覧へ遷移する */
  onClose?: () => void
  /** 一覧に埋め込んだときの変更通知。一覧の再読込に使う */
  onChanged?: () => void
}> = ({ id, onClose, onChanged }) => {
  const { t, fet } = useLocale()
  const tz = useUserTimezone()
  const router = useRouter()
  const { confirmModal } = useConfirmModal()
  const { statusOptions, priorityOptions } = useTicketOptions()
  const boardName = useBoardName()

  const { data: ticket, refresh, isLoading } = useActionData(() => getTicket({ id }))
  const [options, setOptions] = useState<GetTicketFormOptionsReturnType>()
  const [boardAssignees, setBoardAssignees] = useState<MentionCandidate[]>([])
  const [savingField, setSavingField] = useState<EditField>()
  const [draft, setDraft] = useState<Draft>({})
  // 件名は入力途中の値を保持する必要があるため state で持つ
  const [title, setTitle] = useState('')
  // 同期済みのサーバー値。取得し直したかの判定に使う
  const [syncedTicket, setSyncedTicket] = useState<typeof ticket>()
  const [isEditingContent, setEditingContent] = useState(false)
  const [contentDraft, setContentDraft] = useState('')
  const [isSavingContent, setSavingContent] = useState(false)

  useEffect(() => {
    parseAction(getTicketFormOptions())
      .then(setOptions)
      .catch(() => setOptions(undefined))
  }, [])

  // 担当者候補はそのボードのメンバー(プライベートボードなら本人のみ)
  const boardId = ticket?.boardId
  useEffect(() => {
    if (!boardId) {
      return
    }
    // ボードが変わったときに古い要求が後着しうるので、対象が変わった結果は捨てる
    let isCurrent = true
    parseAction(getAssigneeOptions({ id: boardId }))
      .then((res) => isCurrent && setBoardAssignees(res ?? []))
      .catch(() => isCurrent && setBoardAssignees([]))
    return () => {
      isCurrent = false
    }
  }, [boardId])

  // 再取得でサーバー値が変わったら楽観値を捨て、件名の入力欄を同期する(レンダー中に調整)
  if (ticket && ticket !== syncedTicket) {
    setSyncedTicket(ticket)
    setTitle(ticket.title)
    setDraft({})
  }

  /** サーバー値を取り直し、埋め込み元(一覧)にも変更を伝える */
  const refreshAll = async () => {
    await refresh()
    onChanged?.()
  }

  /** 閉じる操作。埋め込み時は選択解除、単独ページでは一覧へ戻る */
  const close = () => {
    if (onClose) {
      onClose()
    } else {
      router.push('/tickets')
    }
  }

  /**
   * 1 項目だけ更新する。保存中は楽観値を表示しておき、refresh で正の値に置き換える。
   * refresh(isLoading を立てない再取得)を await するのは、サーバー値が届くまで
   * 保存中の状態を維持して、旧値が一瞬見えるのを防ぐため。
   */
  const patch = async (field: EditField, input: Partial<PatchTicketIn>) => {
    setSavingField(field)
    setDraft(input)
    try {
      await parseAction(patchTicket({ id, ...input }))
      notify.success(t('msg_saved'))
      await refreshAll()
    } catch {
      // エラー表示は parseAction 側で済んでいる。楽観値を捨ててサーバー値に戻す
      setDraft({})
    } finally {
      setSavingField(undefined)
    }
  }

  /** ステータスはレーン順の再採番を伴うため専用 Action を使う */
  const changeStatus = async (status: TicketStatus) => {
    setSavingField('status')
    setDraft({ status })
    try {
      await parseAction(updateTicketStatus({ id, status }))
      notify.success(t('msg_saved'))
      await refreshAll()
    } catch {
      setDraft({})
    } finally {
      setSavingField(undefined)
    }
  }

  const saveContent = async () => {
    setSavingContent(true)
    try {
      await parseAction(patchTicket({ id, content: contentDraft }))
      notify.success(t('msg_saved'))
      // 表示モードへ戻すのはサーバー値が届いた後。先に戻すと旧本文が一瞬見える
      await refreshAll()
      setEditingContent(false)
    } catch {
      // エラー表示は parseAction 側で済んでいる。編集中の本文を失わせないため編集状態は維持する
    } finally {
      setSavingContent(false)
    }
  }

  const remove = async () => {
    if (!ticket) {
      return
    }
    try {
      const ok = await confirmModal().confirm({
        title: t('confirm_deletion'),
        text: t('msg_confirm_deletion', { target: ticket.title }),
        requireCheck: true,
        autoClose: false,
      })
      if (ok) {
        await parseAction(deleteTicket({ id }))
        notify.success(t('msg_deleted_target', { target: ticket.title }))
        onChanged?.()
        close()
      }
    } finally {
      confirmModal().close()
    }
  }

  if (isLoading) {
    return <PanelSkeleton />
  }

  // parseAction は ClientError を notify せず throw するため、ここで明示的に表示する
  if (!ticket) {
    return (
      <FlexCol>
        <ContentHeader
          title={
            <>
              <CloseButton onClose={onClose} onPress={close} />
              <TicketIcon />
              {t('ticket')}
            </>
          }
        />
        <NoticePanel>{t('msg_no_access')}</NoticePanel>
      </FlexCol>
    )
  }

  const canEdit = ticket.canEdit
  // 保存中の楽観値を優先する。null(クリア) と undefined(未変更) は区別する
  const status = draft.status ?? ticket.status
  const priority = draft.priority ?? ticket.priority
  const assigneeId = draft.assigneeId !== undefined ? draft.assigneeId : ticket.assigneeId
  const dueDate = draft.dueDate !== undefined ? draft.dueDate : utcToDateOnly(ticket.dueDate)
  const tagIds = draft.tagIds ?? ticket.tags.map((tag) => tag.id)

  const titleParsed = zTicketTitle.safeParse(title)
  const titleError = titleParsed.success ? undefined : fet({ message: titleParsed.error.issues[0]?.message })
  const saveTitle = () => {
    if (!titleParsed.success || titleParsed.data === ticket.title) {
      return
    }
    void patch('title', { title: titleParsed.data })
  }

  // 候補が揃うまでは選択肢が空になり選択済みの値が消えてしまうため、表示専用にフォールバックする
  const canEditAssignee = canEdit && boardAssignees.length > 0
  const canEditTags = canEdit && !!options
  const isContentSubmittable = MAX_CONTENT_LENGTH === undefined || contentDraft.length <= MAX_CONTENT_LENGTH

  return (
    <FlexCol>
      <ContentHeader
        title={
          <>
            <CloseButton onClose={onClose} onPress={close} />
            <TicketBreadcrumbs
              boardId={ticket.boardId}
              boardName={boardName({ name: ticket.boardName, kind: ticket.boardKind })}
              title={ticket.title}
            />
            <CopyableField // 表示IDを見せつつ、チャットや議事録へそのまま貼れるURLをコピーさせる
              // 幅を固定しないと input の既定幅で狭い画面のパンくずを潰してしまう
              className='w-36 shrink-0'
              isSmart
              text={ticket.displayId}
              copyText={ticket.shortUrl}
              ariaLabel={t('id')}
              copyLabel={t('copy_url')}
            />
          </>
        }
      />

      <Panel>
        <Grid // 項目の並びは作成モーダル(../modals.tsx の AddModal)と揃えている
          isSmart
        >
          <div className='col-span-12 md:col-span-8'>
            {canEdit ? (
              <InputField
                label={t('title')}
                isRequired
                maxLength={getFieldConstraints(scPatchTicket, 'title').maxLength}
                errorMessage={titleError}
                // 保存中の入力は reload で上書きされてしまうため受け付けない
                disabled={savingField === 'title'}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                // 入力ごとに保存しないよう、フォーカスを外したときに変更を確定する
                onBlur={saveTitle}
              />
            ) : (
              <MetaText label={t('title')}>{ticket.title}</MetaText>
            )}
          </div>

          <div className='col-span-12 md:col-span-4'>
            <MetaText // ボードは詳細画面では変更させない
              label={t('board')}
            >
              {boardName({ name: ticket.boardName, kind: ticket.boardKind })}
            </MetaText>
          </div>

          <div className='col-span-6 md:col-span-2'>
            {canEdit ? (
              <SingleSelectField
                label={t('status')}
                groupOptions={statusOptions}
                value={status}
                isDisabled={savingField === 'status'}
                onChange={(next) => {
                  if (next && next !== ticket.status) {
                    void changeStatus(next as TicketStatus)
                  }
                }}
              />
            ) : (
              <MetaText label={t('status')}>
                <StatusChip status={status} />
              </MetaText>
            )}
          </div>

          <div className='col-span-6 md:col-span-1'>
            {canEdit ? (
              <SingleSelectField
                label={t('priority')}
                groupOptions={priorityOptions}
                value={priority}
                isDisabled={savingField === 'priority'}
                onChange={(next) => {
                  if (next && next !== ticket.priority) {
                    void patch('priority', { priority: next as typeof priority })
                  }
                }}
              />
            ) : (
              <MetaText label={t('priority')}>
                <PriorityChip priority={priority} />
              </MetaText>
            )}
          </div>

          <div className='col-span-6 md:col-span-2'>
            {canEditAssignee ? (
              <AssigneeSelectField
                isClearable
                options={boardAssignees}
                value={assigneeId}
                isDisabled={savingField === 'assigneeId'}
                onChange={(next) => {
                  if (next !== (ticket.assigneeId ?? null)) {
                    void patch('assigneeId', { assigneeId: next })
                  }
                }}
              />
            ) : (
              <MetaText label={t('assignee')}>{ticket.assigneeName || t('unassigned')}</MetaText>
            )}
          </div>

          <div className='col-span-6 md:col-span-3'>
            {canEdit ? (
              <DatePickerField
                label={t('due_date')}
                value={dueDate}
                isDisabled={savingField === 'dueDate'}
                onChange={(next) => {
                  if (next !== utcToDateOnly(ticket.dueDate)) {
                    void patch('dueDate', { dueDate: next })
                  }
                }}
              />
            ) : (
              <MetaText label={t('due_date')}>
                <span className='font-mono text-xs'>{dayformat(ticket.dueDate, 'date') || '-'}</span>
              </MetaText>
            )}
          </div>

          <div className='col-span-12 md:col-span-4'>
            {canEditTags ? (
              <TagIdSelectField
                // そのボードのタグだけを候補にする(他ボードのタグはサーバー側で弾かれる)
                options={options.tags.filter((tag) => tag.boardId === ticket.boardId)}
                onCreate={async (name) => parseAction(createTicketTag({ boardId: ticket.boardId, name }))}
                value={tagIds}
                // 保存中に isDisabled にするとポップオーバーが閉じて連続選択できないため無効化しない
                onChange={(next) => void patch('tagIds', { tagIds: next })}
              />
            ) : (
              <MetaText label={t('tags')}>{ticket.tags.length > 0 ? <TagChips tags={ticket.tags} /> : '-'}</MetaText>
            )}
          </div>
        </Grid>

        <div // 作成 / 更新はチケットの属性ではないので、項目のグリッドから外して注記にする
          className='mt-2 flex flex-wrap items-center gap-x-3 border-t pt-2 text-xs text-gray-500'
        >
          <span>
            {t('created_at')} <span className='font-mono'>{dayformat(ticket.createdAt, 'tz-simple', tz)}</span>
            {ticket.createdByName && <span className='ml-1'>{ticket.createdByName}</span>}
          </span>
          <span>
            {t('updated_at')} <span className='font-mono'>{dayformat(ticket.updatedAt, 'tz-simple', tz)}</span>
          </span>
          {ticket.completedAt && (
            <span>
              {t('completed_at')} <span className='font-mono'>{dayformat(ticket.completedAt, 'tz-simple', tz)}</span>
            </span>
          )}
          {ticket.canDelete && (
            <MultiButton
              isIconOnly
              size='sm'
              variant='danger-soft'
              className='ml-auto'
              tooltip={t('delete')}
              onPress={remove}
            >
              <TrashIcon width={16} />
            </MultiButton>
          )}
        </div>
      </Panel>

      <div className='py-4'>
        <MarkdownField
          body={ticket.content ?? ''}
          isEditing={isEditingContent}
          // 編集中に変わらない値を渡す(MDXEditor は編集モードのマウント時にこの値を取り込む)
          defaultValue={ticket.content ?? ''}
          onChange={setContentDraft}
          length={contentDraft.length}
          maxLength={MAX_CONTENT_LENGTH}
          label={t('content')}
          uploadBoardId={ticket.boardId}
          // メンション候補は担当者候補と同じボードメンバー(取得を 1 本にまとめている)
          mentionCandidates={boardAssignees}
          // ツールバー + 2 行が MarkdownField の最小高に収まるので、短い本文でも高さが動かない
          minRows={2}
          action={
            !isEditingContent &&
            canEdit && (
              <MultiButton
                isIconOnly
                size='sm'
                variant='outline'
                tooltip={t('update')}
                onPress={() => {
                  setContentDraft(ticket.content ?? '')
                  setEditingContent(true)
                }}
              >
                <PencilSquareIcon width={16} />
              </MultiButton>
            )
          }
          footer={
            isEditingContent && (
              <>
                <MultiButton
                  variant='ghost'
                  size='sm'
                  isDisabled={isSavingContent}
                  onPress={() => setEditingContent(false)}
                >
                  {t('cancel')}
                </MultiButton>
                <MultiButton
                  size='sm'
                  icon={<CheckIcon width={16} />}
                  isPending={isSavingContent}
                  isDisabled={!isContentSubmittable}
                  onPress={saveContent}
                >
                  {t('save')}
                </MultiButton>
              </>
            )
          }
        />
        {/* 誰へ届いたのかは本文の外に出す(本文中の @名前 は素のテキストのまま) */}
        {!isEditingContent && <MentionChips names={ticket.mentionedNames} className='mt-1' />}
      </div>

      <TicketComments ticket={ticket} mentionCandidates={boardAssignees} refresh={refreshAll} />
    </FlexCol>
  )
}
