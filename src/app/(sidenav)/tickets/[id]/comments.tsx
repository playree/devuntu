'use client'

import { FlexCol } from '@/components/general/flex'
import { SplitButton, type SplitButtonOption } from '@/components/general/split-button'
import { MultiTagField, type MultiTagItem } from '@/components/general/tag-group'
import { ChatBubbleIcon, CheckIcon } from '@/components/icon'
import { MarkdownInput } from '@/components/markdown/markdown-editor'
import type { MentionCandidate } from '@/components/markdown/mention-menu'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action-client'
import { scCreateTicketComment } from '@/lib/schema'
import { getFieldConstraints } from '@/lib/schema-util'
import { commentAnchorId, decodeSegment, TICKET_COMMENT_TYPE_LOCALE, TICKET_COMMENT_TYPES } from '@/lib/task'
import { useLocale } from '@/locale/client'
import { FC, useEffect, useState, useSyncExternalStore } from 'react'
import { CommentItem, CommentReplyAction, type Comment } from './comment-item'
import { addTicketComment, GetTicketReturnType } from './server'

type Ticket = NonNullable<GetTicketReturnType>

/** コメントの文字数上限(MDXEditor には maxLength 属性が無いのでスキーマから取る) */
const MAX_COMMENT_LENGTH = getFieldConstraints(scCreateTicketComment, 'content').maxLength

/** 投稿フォームの種別選択肢。'none' は通常コメント(type を渡さない) */
type CommentTypeOption = 'none' | (typeof TICKET_COMMENT_TYPES)[number]

/** 位置の追い直しを打ち切るまでの時間 */
const ANCHOR_FOLLOW_MS = 3000

/** 現在のハッシュ。SSR では空文字を返し、ハイドレーション後にクライアントの値へ切り替わる */
const subscribeHash = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}
const useLocationHash = () =>
  useSyncExternalStore(
    subscribeHash,
    () => window.location.hash,
    () => '',
  )

/**
 * 通知のリンク(`#comment-<id>`)で指されたコメントまで移動する。
 *
 * チケットはクライアント側で取得するので、ブラウザ標準のハッシュ移動は要素が無い時点で空振りする。
 * さらに本文の描画(MarkdownView)は動的 import なので、一度移動しても後から各コメントの高さが
 * 伸びて位置がずれる。そのため高さが変わる間は追い直し、落ち着くか利用者が動かしたら止める。
 */
const useCommentAnchor = (comments: Comment[]) => {
  const anchor = decodeSegment(useLocationHash().slice(1)) ?? ''
  // 他の要素の id を拾わないよう、このチケットのコメントに限る
  const targetId = comments.some(({ id }) => commentAnchorId(id) === anchor) ? anchor : ''

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

/** 投稿の共通チェック(MDXEditor には maxLength 属性が無いためここで見る) */
const isSubmittable = (draft: string) =>
  !!draft.trim() && (MAX_COMMENT_LENGTH === undefined || draft.length <= MAX_COMMENT_LENGTH)

/** コメント一覧 + 投稿フォーム */
export const TicketComments: FC<{
  ticket: Ticket
  /** `@` 入力時のメンション候補(そのボードのメンバー) */
  mentionCandidates: MentionCandidate[]
  refresh: () => Promise<void>
}> = ({ ticket, mentionCandidates, refresh }) => {
  const { t } = useLocale()
  const [draft, setDraft] = useState('')
  const [commentType, setCommentType] = useState<CommentTypeOption>('none')
  const [isPosting, setPosting] = useState(false)
  // MDXEditor は markdown prop の変更を取り込まないため、key を変えて空の状態に戻す
  const [editorKey, setEditorKey] = useState(0)

  const { comments } = ticket
  // 返信込みでフラットに展開したもの。通知リンクからのアンカー一致は絞り込みと無関係に動かすため、
  // ここではフィルタ前の全コメントを使う
  const flatComments = comments.flatMap((comment) => [comment, ...comment.replies])
  const targetId = useCommentAnchor(flatComments)

  const [typeFilter, setTypeFilter] = useState<CommentTypeOption[]>(['none', 'plan', 'report'])
  // 種別はスレッド(親コメント)単位で絞り込み、返信は親が表示対象のときだけ追従させる。
  // ただし通知リンクの対象を含むスレッドは、種別に関わらず表示してアンカー移動できるようにする
  const visibleComments = comments.filter(
    (comment) =>
      typeFilter.includes(comment.type ?? 'none') ||
      [comment, ...comment.replies].some((c) => commentAnchorId(c.id) === targetId),
  )
  const visibleCommentCount = visibleComments.flatMap((comment) => [comment, ...comment.replies]).length

  const commentTypeFilterItems: MultiTagItem<CommentTypeOption>[] = [
    { id: 'none', label: t('comment_type_none') },
    { id: 'plan', label: t(TICKET_COMMENT_TYPE_LOCALE.plan) },
    { id: 'report', label: t(TICKET_COMMENT_TYPE_LOCALE.report) },
  ]

  const commentTypeOptions: SplitButtonOption<CommentTypeOption>[] = [
    { id: 'none', menuLabel: t('comment_type_none'), actionLabel: t('send') },
    { id: 'plan', menuLabel: t(TICKET_COMMENT_TYPE_LOCALE.plan), actionLabel: t('send_as_plan') },
    { id: 'report', menuLabel: t(TICKET_COMMENT_TYPE_LOCALE.report), actionLabel: t('send_as_report') },
  ]

  const post = async () => {
    setPosting(true)
    try {
      await parseAction(
        addTicketComment({
          ticketId: ticket.id,
          content: draft,
          type: commentType === 'none' ? null : commentType,
        }),
      )
      notify.success(t('msg_added_comment'))
      setDraft('')
      setCommentType('none')
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
          {t('comment')} ({visibleCommentCount})
        </span>
      </div>

      <MultiTagField
        label={t('comment_type')}
        items={commentTypeFilterItems}
        value={typeFilter}
        onChange={setTypeFilter}
      />

      {visibleComments.map((comment) => (
        <div key={comment.id} className='space-y-2'>
          <CommentItem
            comment={comment}
            boardId={ticket.boardId}
            mentionCandidates={mentionCandidates}
            canDelete={ticket.canDelete}
            isTarget={commentAnchorId(comment.id) === targetId}
            refresh={refresh}
          />
          {(comment.replies.length > 0 || ticket.canEdit) && (
            <div
              className={
                comment.replies.length > 0
                  ? 'ml-6 space-y-2 border-l border-gray-300/50 pl-4 dark:border-gray-600/50'
                  : 'space-y-2'
              }
            >
              {comment.replies.map((reply) => (
                <CommentItem
                  key={reply.id}
                  comment={reply}
                  boardId={ticket.boardId}
                  mentionCandidates={mentionCandidates}
                  canDelete={ticket.canDelete}
                  isTarget={commentAnchorId(reply.id) === targetId}
                  refresh={refresh}
                />
              ))}
              {ticket.canEdit && (
                <CommentReplyAction
                  ticketId={ticket.id}
                  parentId={comment.id}
                  boardId={ticket.boardId}
                  mentionCandidates={mentionCandidates}
                  refresh={refresh}
                />
              )}
            </div>
          )}
        </div>
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
            <SplitButton
              className='ml-auto shrink-0'
              size='sm'
              icon={<CheckIcon width={16} />}
              options={commentTypeOptions}
              selectedId={commentType}
              onSelectChange={setCommentType}
              isPending={isPosting}
              isDisabled={!isSubmittable(draft)}
              onPress={post}
              dropdownLabel={t('comment_type')}
            />
          </div>
        </div>
      )}
    </FlexCol>
  )
}
