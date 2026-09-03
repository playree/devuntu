'use client'

import { AccordionSection } from '@/components/general/accordion'
import { MultiButton } from '@/components/general/button'
import { useConfirmModal } from '@/components/general/modal'
import { Panel } from '@/components/general/panel'
import {
  CheckIcon,
  ClipboardDocumentCheckIcon,
  ClipboardDocumentIcon,
  PencilSquareIcon,
  ReplyIcon,
  TrashIcon,
} from '@/components/icon'
import { MarkdownInput } from '@/components/markdown/markdown-editor'
import { MarkdownView } from '@/components/markdown/markdown-view'
import type { MentionCandidate } from '@/components/markdown/mention-menu'
import { notify } from '@/components/notify'
import { MentionChips } from '@/components/ticket/mention-chips'
import { parseAction } from '@/lib/action/action-client'
import { commentAnchorId, TICKET_COMMENT_TYPE_LOCALE } from '@/lib/board/task'
import { dayformat } from '@/lib/day'
import { scCreateTicketComment } from '@/lib/schema/schema'
import { getFieldConstraints } from '@/lib/schema/schema-util'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { Accordion } from '@heroui/react'
import { FC, useState } from 'react'
import { tv } from 'tailwind-variants'
import { addTicketComment, deleteTicketComment, GetTicketReturnType, updateTicketComment } from './server'

type Ticket = NonNullable<GetTicketReturnType>
export type Comment = Omit<Ticket['comments'][number], 'replies'>

/** コメントの文字数上限(MDXEditor には maxLength 属性が無いのでスキーマから取る) */
const MAX_COMMENT_LENGTH = getFieldConstraints(scCreateTicketComment, 'content').maxLength

/** 投稿・返信・編集で共通のチェック(MDXEditor には maxLength 属性が無いためここで見る) */
const isSubmittable = (draft: string) =>
  !!draft.trim() && (MAX_COMMENT_LENGTH === undefined || draft.length <= MAX_COMMENT_LENGTH)

/** 通知のリンクから開いた 1 件を目立たせる枠(かんばんの選択カードと同じ表現) */
const commentStyles = tv({
  variants: {
    isTarget: { true: 'ring-2 ring-blue-500' },
  },
})

/** コメント 1 件。投稿者本人なら編集できる */
export const CommentItem: FC<{
  comment: Comment
  boardId: string
  /** `@` 入力時のメンション候補(そのボードのメンバー) */
  mentionCandidates: MentionCandidate[]
  canDelete: boolean
  /** 通知のリンク(`#comment-<id>`)で指されている 1 件 */
  isTarget: boolean
  refresh: () => Promise<void>
}> = ({ comment, boardId, mentionCandidates, canDelete, isTarget, refresh }) => {
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
      // 表示モードへ戻すのはサーバー値が届いた後。先に戻すと旧本文が一瞬見える
      await refresh()
      setEditing(false)
    } catch {
      // エラー表示は parseAction 側で済んでいる。入力中の内容を失わせないため編集状態は維持する
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
    <Panel // 通知の URL から直接開けるよう、コメント単位のアンカーを置く
      variant='shadow'
      id={commentAnchorId(comment.id)}
      className={commentStyles({ isTarget })}
    >
      <div className='flex items-center gap-2 text-xs text-gray-500'>
        <span className='font-medium'>{comment.authorName || t('no_name')}</span>
        <span className='font-mono'>{dayformat(comment.createdAt, 'tz-simple', tz)}</span>
        <div className='ml-auto flex gap-0.5'>
          {comment.isMine && !isEditing && (
            <MultiButton
              isIconOnly
              size='sm'
              variant='outline'
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
              variant='outline'
              className='h-7 w-7 rounded-sm'
              tooltip={t('delete')}
              onPress={remove}
            >
              <TrashIcon width={16} className='text-red-400' />
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
            uploadBoardId={boardId}
            mentionCandidates={mentionCandidates}
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
      ) : comment.type ? (
        // plan / report は長文になりやすいので折りたたみ、デフォルトは閉じておく
        <Accordion defaultExpandedKeys={[]} hideSeparator className='mt-1'>
          <AccordionSection
            id='body'
            icon={
              comment.type === 'plan' ? <ClipboardDocumentIcon width={16} /> : <ClipboardDocumentCheckIcon width={16} />
            }
            title={t(TICKET_COMMENT_TYPE_LOCALE[comment.type])}
            bodyClassName='px-0'
          >
            <MarkdownView body={comment.content} mentionUsers={mentionCandidates} />
          </AccordionSection>
        </Accordion>
      ) : (
        <MarkdownView body={comment.content} className='mt-1' mentionUsers={mentionCandidates} />
      )}

      <MentionChips names={comment.mentionedNames} className='mt-2' />
    </Panel>
  )
}

/** 返信ボタン + 返信フォーム。返信自体には出さない(スレッドは 1 階層のみ)ため親コメント側にのみ置く */
export const CommentReplyAction: FC<{
  ticketId: string
  parentId: string
  boardId: string
  /** `@` 入力時のメンション候補(そのボードのメンバー) */
  mentionCandidates: MentionCandidate[]
  refresh: () => Promise<void>
}> = ({ ticketId, parentId, boardId, mentionCandidates, refresh }) => {
  const { t } = useLocale()
  const [isReplying, setReplying] = useState(false)
  const [replyDraft, setReplyDraft] = useState('')
  const [isReplyPosting, setReplyPosting] = useState(false)

  const postReply = async () => {
    setReplyPosting(true)
    try {
      await parseAction(addTicketComment({ ticketId, content: replyDraft, parentId }))
      notify.success(t('msg_added_comment'))
      setReplyDraft('')
      setReplying(false)
      await refresh()
    } catch {
      // エラー表示は parseAction 側で済んでいる。再投稿できるよう draft は消さない
    } finally {
      setReplyPosting(false)
    }
  }

  return isReplying ? (
    <div className='space-y-2 pb-2'>
      <MarkdownInput
        defaultValue=''
        onChange={setReplyDraft}
        length={replyDraft.length}
        maxLength={MAX_COMMENT_LENGTH}
        label={t('reply')}
        uploadBoardId={boardId}
        mentionCandidates={mentionCandidates}
      />
      <div className='flex justify-end gap-2'>
        <MultiButton variant='ghost' size='sm' onPress={() => setReplying(false)}>
          {t('cancel')}
        </MultiButton>
        <MultiButton
          size='sm'
          icon={<CheckIcon width={16} />}
          isPending={isReplyPosting}
          isDisabled={!isSubmittable(replyDraft)}
          onPress={postReply}
        >
          {t('send')}
        </MultiButton>
      </div>
    </div>
  ) : (
    <MultiButton
      className='mb-2'
      variant='outline'
      icon={<ReplyIcon width={16} />}
      size='sm'
      onPress={() => setReplying(true)}
    >
      {t('reply')}
    </MultiButton>
  )
}
