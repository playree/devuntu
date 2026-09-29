'use client'

import { AGENT_TASK_MODE_LOCALE } from '@/lib/agent/agent'
import { TICKET_CHILD_ADVANCE_LOCALE } from '@/lib/board/ticket-relation-rule'
import type { ChildProposal } from '@/lib/schema/schema-ticket'
import { useLocale } from '@/locale/client'
import { FC } from 'react'

/** plan に付いた子チケットの起票案。承認すると、この内容で子チケットが起票される */
export const ChildProposalView: FC<{ proposal: ChildProposal }> = ({ proposal }) => {
  const { t } = useLocale()

  return (
    <div className='mt-2 space-y-1 border-t pt-2'>
      <div className='flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs'>
        <span className='text-foreground'>
          {t('proposal_children')} ({proposal.children.length})
        </span>
        {proposal.advance && (
          <span className='text-muted'>
            {t('child_advance')}: {t(TICKET_CHILD_ADVANCE_LOCALE[proposal.advance])}
          </span>
        )}
      </div>
      <ol className='space-y-1'>
        {proposal.children.map((child, index) => (
          <li
            key={index} // 起票前の案なので ID が無く、並びも変わらない
            className='dark:bg-default/40 rounded-lg bg-white px-2 py-1'
          >
            <div className='flex flex-wrap items-center gap-x-2 text-sm'>
              <span className='text-muted font-mono text-xs' title={t('child_order')}>
                #{child.order}
              </span>
              <span className='min-w-0 text-xs wrap-anywhere'>{child.title}</span>
              <span className='text-muted text-xs'>
                {child.mode ? t(AGENT_TASK_MODE_LOCALE[child.mode]) : t('proposal_human')}
              </span>
              {child.acceptanceCriteria.length > 0 && (
                <span className='text-muted text-xs'>
                  {t('acceptance_criteria')} {child.acceptanceCriteria.length}
                </span>
              )}
            </div>
            {child.content && (
              <p className='text-muted line-clamp-3 text-xs wrap-anywhere whitespace-pre-wrap'>{child.content}</p>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
