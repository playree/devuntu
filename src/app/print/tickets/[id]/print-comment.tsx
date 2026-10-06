'use client'

import type { MentionCandidate } from '@/components/markdown/mention-menu'
import type { PrintableComment } from '@/lib/board/ticket-print'
import { FC } from 'react'
import {
  CommentMeta,
  CommentTypeLabel,
  PrintCommentBody,
  type PrintCommentData,
  PrintHeader,
  type PrintTicketData,
} from './print-parts'

/** プラン/報告書の 1 件。どのチケットのものか分かるよう、見出しにチケットを添える */
export const PrintComment: FC<{
  ticket: PrintTicketData
  comment: PrintableComment<PrintCommentData>
  mentionUsers: MentionCandidate[]
}> = ({ ticket, comment, mentionUsers }) => (
  <article>
    <PrintHeader
      ticket={ticket}
      subtitle={
        <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
          <CommentTypeLabel type={comment.type} />
          <CommentMeta comment={comment} />
        </div>
      }
    />
    <div className='mt-4'>
      <PrintCommentBody comment={comment} mentionUsers={mentionUsers} />
    </div>
  </article>
)
