'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { useConfirmModal } from '@/components/general/modal'
import { Panel } from '@/components/general/panel'
import { ChatBubbleIcon, CheckIcon, PencilSquareIcon, TrashIcon } from '@/components/icon'
import { MarkdownInput } from '@/components/markdown/markdown-editor'
import { MarkdownView } from '@/components/markdown/markdown-view'
import type { MentionCandidate } from '@/components/markdown/mention-menu'
import { notify } from '@/components/notify'
import { MentionChips } from '@/components/ticket/mention-chips'
import { parseAction } from '@/lib/action-client'
import { dayformat } from '@/lib/day'
import { scCreateTicketComment } from '@/lib/schema'
import { getFieldConstraints } from '@/lib/schema-util'
import { commentAnchorId } from '@/lib/task'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { FC, useEffect, useRef, useState } from 'react'
import { tv } from 'tailwind-variants'
import { addTicketComment, deleteTicketComment, GetTicketReturnType, updateTicketComment } from './server'

type Ticket = NonNullable<GetTicketReturnType>
type Comment = Ticket['comments'][number]

/** コメントの文字数上限(MDXEditor には maxLength 属性が無いのでスキーマから取る) */
const MAX_COMMENT_LENGTH = getFieldConstraints(scCreateTicketComment, 'content').maxLength

/** 通知のリンクから開いた 1 件を目立たせる枠(かんばんの選択カードと同じ表現) */
const commentStyles = tv({
  variants: {
    isTarget: { true: 'ring-2 ring-blue-500' },
  },
})

/** 位置の追い直しを打ち切るまでの時間 */
const ANCHOR_FOLLOW_MS = 3000

/**
 * 通知のリンク(`#comment-<id>`)で指されたコメントまで移動する。
 *
 * チケットはクライアント側で取得するので、ブラウザ標準のハッシュ移動は要素が無い時点で空振りする。
 * さらに本文の描画(MarkdownView)は動的 import なので、一度移動しても後から各コメントの高さが
 * 伸びて位置がずれる。そのため高さが変わる間は追い直し、落ち着くか利用者が動かしたら止める。
 */
const useCommentAnchor = (comments: Comment[]) => {
  const [targetId, setTargetId] = useState('')
  // 投稿・編集のたびに再取得が走るので、ハッシュを見るのは最初の一度だけにする
  const isResolved = useRef(false)

  useEffect(() => {
    if (isResolved.current) {
      return
    }
    const anchor = decodeURIComponent(window.location.hash.slice(1))
    // 他の要素の id を拾わないよう、このチケットのコメントに限る
    if (!comments.some(({ id }) => commentAnchorId(id) === anchor)) {
      return
    }
    isResolved.current = true
    setTargetId(anchor)
  }, [comments])

  useEffect(() => {
    const element = targetId ? document.getElementById(targetId) : null
    // 一覧そのもの(= コメントの親)を見れば、上に並ぶコメントが伸びた分も拾える
    const list = element?.parentElement
    if (!element || !list) {
      return
    }

    const scroll = () => element.scrollIntoView({ block: 'center' })
    scroll()

    const observer = new ResizeObserver(scroll)
    observer.observe(list)
    const stop = () => observer.disconnect()
    const timer = setTimeout(stop, ANCHOR_FOLLOW_MS)
    // 利用者が自分で動かし始めたら、そちらを優先して追従をやめる
    window.addEventListener('wheel', stop, { passive: true })
    window.addEventListener('touchstart', stop, { passive: true })
    window.addEventListener('keydown', stop)

    return () => {
      clearTimeout(timer)
      stop()
      window.removeEventListener('wheel', stop)
      window.removeEventListener('touchstart', stop)
      window.removeEventListener('keydown', stop)
    }
  }, [targetId])

  return targetId
}

/** 投稿・編集の共通チェック(MDXEditor には maxLength 属性が無いためここで見る) */
const isSubmittable = (draft: string) =>
  !!draft.trim() && (MAX_COMMENT_LENGTH === undefined || draft.length <= MAX_COMMENT_LENGTH)

/** コメント 1 件。投稿者本人なら編集できる */
const CommentItem: FC<{
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
              variant='ghost'
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
              variant='ghost'
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
      ) : (
        <MarkdownView body={comment.content} className='mt-1' mentionUsers={mentionCandidates} />
      )}

      <MentionChips names={comment.mentionedNames} className='mt-2' />
    </Panel>
  )
}

/** コメント一覧 + 投稿フォーム */
export const TicketComments: FC<{
  ticket: Ticket
  /** `@` 入力時のメンション候補(そのボードのメンバー) */
  mentionCandidates: MentionCandidate[]
  refresh: () => Promise<void>
}> = ({ ticket, mentionCandidates, refresh }) => {
  const { t } = useLocale()
  const [draft, setDraft] = useState('')
  const [isPosting, setPosting] = useState(false)
  // MDXEditor は markdown prop の変更を取り込まないため、key を変えて空の状態に戻す
  const [editorKey, setEditorKey] = useState(0)

  const { comments } = ticket
  const targetId = useCommentAnchor(comments)

  const post = async () => {
    setPosting(true)
    try {
      await parseAction(addTicketComment({ ticketId: ticket.id, content: draft }))
      notify.success(t('msg_added_comment'))
      setDraft('')
      setEditorKey((n) => n + 1)
      await refresh()
    } catch {
      // エラー表示は parseAction 側で済んでいる。再投稿できるよう draft は消さない
    } finally {
      setPosting(false)
    }
  }

  return (
    <FlexCol isSmart>
      <div className='flex items-center gap-2'>
        <ChatBubbleIcon />
        <span>
          {t('comment')} ({comments.length})
        </span>
      </div>

      {comments.map((comment) => (
        <CommentItem
          key={comment.id}
          comment={comment}
          boardId={ticket.boardId}
          mentionCandidates={mentionCandidates}
          canDelete={ticket.canDelete}
          isTarget={commentAnchorId(comment.id) === targetId}
          refresh={refresh}
        />
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
            uploadBoardId={ticket.boardId}
            mentionCandidates={mentionCandidates}
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
