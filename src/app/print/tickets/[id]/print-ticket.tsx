'use client'

import { CheckBadgeIcon, XCircleIcon } from '@/components/icon'
import type { MentionCandidate } from '@/components/markdown/mention-menu'
import { PriorityChip, StatusChip, TagChips, TicketIdText } from '@/components/ticket/ticket-chip'
import { CiStatusChip, PullRequestStateChip } from '@/components/ticket/ticket-link-chip'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { dayformat } from '@/lib/day'
import { ticketLinkLabel } from '@/lib/git/git'
import { useLocale } from '@/locale/client'
import { FC, ReactNode } from 'react'
import {
  CommentMeta,
  CommentTypeLabel,
  PrintCommentBody,
  type PrintCommentData,
  PrintHeader,
  PrintMarkdown,
  PrintSection,
  type PrintTicketData,
} from './print-parts'

type RelatedTicket = PrintTicketData['relations']['related'][number]

/** 項目表の 1 行 */
const FieldRow: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <div className='flex min-h-7 items-center gap-2 border-b py-0.5 text-sm'>
    <span className='text-muted w-24 shrink-0 text-xs'>{label}</span>
    <div className='flex min-w-0 flex-wrap items-center gap-2'>{children}</div>
  </div>
)

const PrintFields: FC<{ ticket: PrintTicketData }> = ({ ticket }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  return (
    <div className='mt-3 grid grid-cols-1 gap-x-6 sm:grid-cols-2 print:grid-cols-2'>
      <FieldRow label={t('status')}>
        <StatusChip value={ticket.status} />
      </FieldRow>
      <FieldRow label={t('priority')}>
        <PriorityChip value={ticket.priority} />
      </FieldRow>
      <FieldRow label={t('assignee')}>{ticket.assigneeName || t('unassigned')}</FieldRow>
      <FieldRow label={t('due_date')}>
        <span className='font-mono text-xs'>{dayformat(ticket.dueDate, 'date') || '-'}</span>
      </FieldRow>
      <FieldRow label={t('created_at')}>
        <span className='font-mono text-xs'>{dayformat(ticket.createdAt, 'tz-minute', tz)}</span>
        {ticket.createdByName && <span className='text-xs'>{ticket.createdByName}</span>}
      </FieldRow>
      <FieldRow label={t('updated_at')}>
        <span className='font-mono text-xs'>{dayformat(ticket.updatedAt, 'tz-minute', tz)}</span>
      </FieldRow>
      <FieldRow label={t('completed_at')}>
        <span className='font-mono text-xs'>{dayformat(ticket.completedAt, 'tz-minute', tz) || '-'}</span>
      </FieldRow>
      <FieldRow label={t('tags')}>{ticket.tags.length > 0 ? <TagChips tags={ticket.tags} /> : '-'}</FieldRow>
    </div>
  )
}

/** 受け入れ条件。画面ではポップオーバーに隠しているエージェントの根拠も、紙では全文を出す */
const PrintCriteria: FC<{ criteria: PrintTicketData['criteria'] }> = ({ criteria }) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  return (
    <ul className='space-y-1'>
      {criteria.map((criterion) => (
        <li key={criterion.id} className='break-inside-avoid border-b pb-1'>
          <div className='flex items-start gap-1.5 text-sm'>
            <span className='font-mono'>{criterion.checkedAt ? '☑' : '☐'}</span>
            <span className='wrap-anywhere'>{criterion.text}</span>
          </div>
          {(criterion.agentMet !== null || criterion.checkedAt) && (
            <div className='text-muted space-y-0.5 pl-5 text-xs'>
              {criterion.agentMet !== null && (
                <div className='flex items-start gap-1'>
                  {criterion.agentMet ? (
                    <CheckBadgeIcon width={14} className='text-success shrink-0' />
                  ) : (
                    <XCircleIcon width={14} className='text-danger shrink-0' />
                  )}
                  <span className='wrap-anywhere whitespace-pre-wrap'>
                    {t('criterion_self_report')}:{' '}
                    {t(criterion.agentMet ? 'criterion_agent_met' : 'criterion_agent_unmet')}
                    {criterion.agentEvidence && ` - ${criterion.agentEvidence}`}
                  </span>
                </div>
              )}
              {criterion.checkedAt && (
                <div className='flex items-center gap-1'>
                  <CheckBadgeIcon width={14} className='text-success shrink-0' />
                  {t('criterion_checked_by', { name: criterion.checkedByName || t('no_name') })}
                  <span className='ml-2 font-mono'>{dayformat(criterion.checkedAt, 'tz-minute', tz)}</span>
                </div>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

const RelatedRow: FC<{ item: RelatedTicket; order?: number }> = ({ item, order }) => (
  <li className='flex flex-wrap items-center gap-x-2 text-sm'>
    {order !== undefined && <span className='text-muted font-mono text-xs'>#{order}</span>}
    <TicketIdText displayId={item.displayId} />
    <span className='min-w-0 text-xs wrap-anywhere'>{item.title}</span>
    <StatusChip value={item.status} />
    {item.assigneeName && <span className='text-muted text-xs'>{item.assigneeName}</span>}
  </li>
)

const RelationGroup: FC<{ title: string; children: ReactNode }> = ({ title, children }) => (
  <div className='break-inside-avoid'>
    <div className='text-muted text-xs'>{title}</div>
    <ul className='space-y-0.5 pl-2'>{children}</ul>
  </div>
)

const PrintRelations: FC<{ relations: PrintTicketData['relations'] }> = ({
  relations: { parent, children, related },
}) => {
  const { t } = useLocale()
  return (
    <div className='space-y-2'>
      {parent && (
        <RelationGroup title={t('parent_ticket')}>
          <RelatedRow item={parent} />
        </RelationGroup>
      )}
      {children.length > 0 && (
        <RelationGroup title={t('child_tickets')}>
          {children.map((child) => (
            <RelatedRow key={child.relationId} item={child} order={child.order} />
          ))}
        </RelationGroup>
      )}
      {related.length > 0 && (
        <RelationGroup title={t('related_tickets')}>
          {related.map((item) => (
            <RelatedRow key={item.relationId} item={item} />
          ))}
        </RelationGroup>
      )}
    </div>
  )
}

/** 関連リンク。紙ではリンクを辿れないので URL も文字で出す */
const PrintLinks: FC<{ links: PrintTicketData['links'] }> = ({ links }) => (
  <ul className='space-y-1'>
    {links.map((link) => (
      <li key={link.id} className='break-inside-avoid text-sm'>
        <div className='flex flex-wrap items-center gap-x-2'>
          <span className='font-mono'>{ticketLinkLabel(link)}</span>
          {link.title && <span className='text-muted wrap-anywhere'>{link.title}</span>}
          {link.prState && <PullRequestStateChip value={link.prState} />}
          {link.ci && <CiStatusChip value={link.ci} />}
        </div>
        <div className='text-muted font-mono text-xs wrap-anywhere'>{link.url}</div>
      </li>
    ))}
  </ul>
)

const PrintCommentItem: FC<{ comment: PrintCommentData; mentionUsers: MentionCandidate[] }> = ({
  comment,
  mentionUsers,
}) => (
  <div className='border-b pb-2'>
    {comment.type && <CommentTypeLabel type={comment.type} className='mb-1 text-sm' />}
    <CommentMeta comment={comment} />
    <PrintCommentBody comment={comment} mentionUsers={mentionUsers} />
  </div>
)

/** チケット全体。変更履歴は含めない */
export const PrintTicket: FC<{ ticket: PrintTicketData; mentionUsers: MentionCandidate[] }> = ({
  ticket,
  mentionUsers,
}) => {
  const { t } = useLocale()
  const { parent, children, related } = ticket.relations
  const commentCount = ticket.comments.reduce((count, comment) => count + 1 + comment.replies.length, 0)

  return (
    <article>
      <PrintHeader ticket={ticket} />
      <PrintFields ticket={ticket} />

      <PrintSection title={t('content')}>
        <PrintMarkdown body={ticket.content} mentionUsers={mentionUsers} />
      </PrintSection>

      {ticket.criteria.length > 0 && (
        <PrintSection title={t('acceptance_criteria')}>
          <PrintCriteria criteria={ticket.criteria} />
        </PrintSection>
      )}

      {(parent || children.length > 0 || related.length > 0) && (
        <PrintSection title={t('ticket_relations')}>
          <PrintRelations relations={ticket.relations} />
        </PrintSection>
      )}

      {ticket.links.length > 0 && (
        <PrintSection title={t('ticket_links')}>
          <PrintLinks links={ticket.links} />
        </PrintSection>
      )}

      {ticket.comments.length > 0 && (
        <PrintSection title={`${t('comment')} (${commentCount})`}>
          <div className='space-y-3'>
            {ticket.comments.map(({ replies, ...comment }) => (
              <div key={comment.id}>
                <PrintCommentItem comment={comment} mentionUsers={mentionUsers} />
                {replies.length > 0 && (
                  <div // 返信は 1 階層のみなので、字下げで親との関係を示す
                    className='mt-2 ml-6 space-y-2'
                  >
                    {replies.map((reply) => (
                      <PrintCommentItem key={reply.id} comment={reply} mentionUsers={mentionUsers} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </PrintSection>
      )}
    </article>
  )
}
