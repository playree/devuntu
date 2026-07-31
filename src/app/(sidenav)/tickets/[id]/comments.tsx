'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { useConfirmModal } from '@/components/general/modal'
import { ChatBubbleIcon, CheckIcon, PencilSquareIcon, TrashIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { MarkdownInput } from '@/components/ticket/markdown-editor'
import { MarkdownView } from '@/components/ticket/markdown-view'
import { parseAction } from '@/lib/action-client'
import { dayformat } from '@/lib/day'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { Chip } from '@heroui/react'
import { FC, useState } from 'react'
import { addTicketComment, deleteTicketComment, GetTicketReturnType, updateTicketComment } from './server'

type Ticket = NonNullable<GetTicketReturnType>
type Comment = Ticket['comments'][number]

/** zCommentContent の max と一致させる */
const MAX_COMMENT_LENGTH = 5000

/** 投稿・編集の共通チェック(MDXEditor には maxLength 属性が無いためここで見る) */
const isSubmittable = (draft: string) => !!draft.trim() && draft.length <= MAX_COMMENT_LENGTH

/** コメント 1 件。投稿者本人なら編集できる */
const CommentItem: FC<{ comment: Comment; canDelete: boolean; refresh: () => Promise<void> }> = ({
  comment,
  canDelete,
  refresh,
}) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const { confirmModal } = useConfirmModal()
  const [isEditing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.content)
  const [isSaving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await parseAction(updateTicketComment({ id: comment.id, content: draft }))
      notify.success(t('msg_saved'))
      setEditing(false)
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    try {
      const ok = await confirmModal().confirm({
        title: t('confirm_deletion'),
        text: t('msg_confirm_deletion', { target: t('comment') }),
        requireCheck: true,
        autoClose: false,
      })
      if (ok) {
        await parseAction(deleteTicketComment({ id: comment.id }))
        notify.success(t('msg_deleted_target', { target: t('comment') }))
        await refresh()
      }
    } finally {
      confirmModal().close()
    }
  }

  return (
    <div className='rounded-xl border-2 p-2'>
      <div className='flex items-center gap-2 text-xs text-gray-500'>
        <span className='font-medium'>{comment.authorName || t('no_name')}</span>
        <span className='font-mono'>{dayformat(comment.createdAt, 'tz-simple', tz)}</span>
        <div className='ml-auto flex gap-0.5'>
          {comment.isMine && !isEditing && (
            <MultiButton
              isIconOnly
              size='sm'
              variant='tertiary'
              className='h-7 w-7 rounded-sm'
              tooltip={t('update')}
              onPress={() => {
                setDraft(comment.content)
                setEditing(true)
              }}
            >
              <PencilSquareIcon width={16} />
            </MultiButton>
          )}
          {(comment.isMine || canDelete) && (
            <MultiButton
              isIconOnly
              size='sm'
              variant='danger-soft'
              className='h-7 w-7 rounded-sm'
              tooltip={t('delete')}
              onPress={remove}
            >
              <TrashIcon width={16} />
            </MultiButton>
          )}
        </div>
      </div>

      {isEditing ? (
        <div className='mt-2 space-y-2'>
          <MarkdownInput
            defaultValue={comment.content}
            onChange={setDraft}
            length={draft.length}
            maxLength={MAX_COMMENT_LENGTH}
            label={t('comment')}
          />
          <div className='flex justify-end gap-2'>
            <MultiButton variant='ghost' size='sm' onPress={() => setEditing(false)}>
              {t('cancel')}
            </MultiButton>
            <MultiButton
              size='sm'
              icon={<CheckIcon width={16} />}
              isPending={isSaving}
              isDisabled={!isSubmittable(draft)}
              onPress={save}
            >
              {t('save')}
            </MultiButton>
          </div>
        </div>
      ) : (
        <MarkdownView body={comment.content} className='mt-1' />
      )}

      {comment.mentionedNames.length > 0 && (
        <div className='mt-2 flex flex-wrap items-center gap-1'>
          <span className='text-xs text-gray-500'>{t('mentioned')}</span>
          {comment.mentionedNames.map((name) => (
            <Chip key={name} variant='soft' color='accent' size='sm'>
              <Chip.Label>{name}</Chip.Label>
            </Chip>
          ))}
        </div>
      )}
    </div>
  )
}

/** コメント一覧 + 投稿フォーム */
export const TicketComments: FC<{ ticket: Ticket; refresh: () => Promise<void> }> = ({ ticket, refresh }) => {
  const { t } = useLocale()
  const [draft, setDraft] = useState('')
  const [isPosting, setPosting] = useState(false)
  // MDXEditor は markdown prop の変更を取り込まないため、key を変えて空の状態に戻す
  const [editorKey, setEditorKey] = useState(0)

  const post = async () => {
    setPosting(true)
    try {
      await parseAction(addTicketComment({ ticketId: ticket.id, content: draft }))
      notify.success(t('msg_added_comment'))
      setDraft('')
      setEditorKey((n) => n + 1)
      await refresh()
    } finally {
      setPosting(false)
    }
  }

  return (
    <FlexCol>
      <div className='flex items-center gap-2'>
        <ChatBubbleIcon />
        <span>
          {t('comment')} ({ticket.comments.length})
        </span>
      </div>

      {ticket.comments.map((comment) => (
        <CommentItem key={comment.id} comment={comment} canDelete={ticket.canDelete} refresh={refresh} />
      ))}

      {ticket.canEdit && (
        <div className='space-y-2'>
          <MarkdownInput
            key={editorKey}
            defaultValue=''
            onChange={setDraft}
            length={draft.length}
            maxLength={MAX_COMMENT_LENGTH}
            label={t('add_comment')}
          />
          <div className='flex items-center gap-2'>
            <span className='text-xs text-gray-500'>{t('msg_mention_hint')}</span>
            <MultiButton
              className='ml-auto shrink-0'
              size='sm'
              icon={<CheckIcon width={16} />}
              isPending={isPosting}
              isDisabled={!isSubmittable(draft)}
              onPress={post}
            >
              {t('send')}
            </MultiButton>
          </div>
        </div>
      )}
    </FlexCol>
  )
}
