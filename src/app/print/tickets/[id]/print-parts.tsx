'use client'

import { ChildProposalView } from '@/app/(sidenav)/tickets/[id]/child-proposal'
import type { Comment } from '@/app/(sidenav)/tickets/[id]/comment-item'
import type { GetTicketReturnType } from '@/app/(sidenav)/tickets/[id]/server'
import { MarkdownView } from '@/components/markdown/markdown-view'
import type { MentionCandidate } from '@/components/markdown/mention-menu'
import { CommentTypeIcon } from '@/components/ticket/comment-type-icon'
import { MentionChips } from '@/components/ticket/mention-chips'
import { DecisionChip, TicketIdText } from '@/components/ticket/ticket-chip'
import { useBoardName } from '@/components/ticket/ticket-options'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { TICKET_COMMENT_TYPE_LOCALE } from '@/lib/board/ticket-enum'
import { dayformat } from '@/lib/day'
import { useLocale } from '@/locale/client'
import { cn } from '@heroui/react'
import { FC, ReactNode } from 'react'

export type PrintTicketData = NonNullable<GetTicketReturnType>
export type PrintCommentData = Comment

/** 文書の見出し。表示ID・件名・ボード名 */
export const PrintHeader: FC<{ ticket: PrintTicketData; subtitle?: ReactNode }> = ({ ticket, subtitle }) => {
  const boardName = useBoardName()
  return (
    <header className='border-b pb-2'>
      <div className='text-muted flex flex-wrap items-center gap-x-3 text-xs'>
        <TicketIdText displayId={ticket.displayId} />
        <span>{boardName({ name: ticket.boardName, kind: ticket.boardKind })}</span>
      </div>
      <h1 className='mt-1 text-xl font-semibold wrap-anywhere'>{ticket.title}</h1>
      {subtitle && <div className='mt-1'>{subtitle}</div>}
    </header>
  )
}

/** 区切りの見出し付きのまとまり。見出しだけがページ末尾に取り残されないようにする */
export const PrintSection: FC<{ title: ReactNode; children: ReactNode }> = ({ title, children }) => (
  <section className='mt-6'>
    <h2 className='mb-2 break-after-avoid border-b pb-1 text-base font-semibold'>{title}</h2>
    {children}
  </section>
)

/** Markdown 本文。空のときは `-` */
export const PrintMarkdown: FC<{ body: string | null; mentionUsers: MentionCandidate[] }> = ({ body, mentionUsers }) =>
  body?.trim() ? <MarkdownView body={body} mentionUsers={mentionUsers} /> : <div className='text-sm'>-</div>

/** プラン/報告書の種別の見出し(アイコン + 名称) */
export const CommentTypeLabel: FC<{ type: NonNullable<PrintCommentData['type']>; className?: string }> = ({
  type,
  className,
}) => {
  const { t } = useLocale()
  return (
    <span className={cn('flex items-center gap-1 font-semibold', className)}>
      <CommentTypeIcon type={type} />
      {t(TICKET_COMMENT_TYPE_LOCALE[type])}
    </span>
  )
}

/** コメントの投稿者・日時・判定 */
export const CommentMeta: FC<{ comment: PrintCommentData }> = ({ comment }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  return (
    <div className='text-muted flex flex-wrap items-center gap-2 text-xs'>
      <span className='font-medium'>{comment.authorName || t('no_name')}</span>
      <span className='font-mono'>{dayformat(comment.createdAt, 'tz-minute', tz)}</span>
      {comment.decision && <DecisionChip value={comment.decision} />}
    </div>
  )
}

/** コメント 1 件の本文。プラン/報告書も折りたたまずに全文を出す */
export const PrintCommentBody: FC<{ comment: PrintCommentData; mentionUsers: MentionCandidate[] }> = ({
  comment,
  mentionUsers,
}) => (
  <>
    <MarkdownView body={comment.content} className='mt-1' mentionUsers={mentionUsers} />
    {comment.proposal && <ChildProposalView proposal={comment.proposal} />}
    <MentionChips names={comment.mentionedNames} className='mt-2' />
  </>
)
