'use client'

import { getTicket } from '@/app/(sidenav)/tickets/[id]/server'
import { useBoardAssignees } from '@/app/(sidenav)/tickets/use-ticket-form'
import { PanelSkeleton } from '@/components/general/panel'
import { TicketIcon } from '@/components/icon'
import { NoAccessView } from '@/components/no-access-view'
import { PrintToolbar, useSaveHtml } from '@/components/print-export'
import { useActionData } from '@/lib/action/action-client'
import { authClient } from '@/lib/auth/auth-client'
import { TICKET_COMMENT_TYPE_LOCALE } from '@/lib/board/ticket-enum'
import { findPrintableComment, ticketExportFileName, ticketPrintTitle } from '@/lib/board/ticket-print'
import type { PrintFormat } from '@/lib/print-export'
import { useWhenRendered } from '@/lib/use-when-rendered'
import { useLocale } from '@/locale/client'
import { FC, useEffect, useRef } from 'react'
import { PrintComment } from './print-comment'
import { PrintTicket } from './print-ticket'

/**
 * チケットの印刷用ページ。commentId を渡すとそのプラン/報告書だけ、無ければチケット全体を出す。
 * 描画が終わったら format に応じて印刷ダイアログを開くか、HTML を保存する。
 * 認可はチケット詳細と同じ getTicket で行う
 */
export const TicketPrintClient: FC<{ id: string; commentId?: string; format: PrintFormat }> = ({
  id,
  commentId,
  format,
}) => {
  const { t } = useLocale()
  const ref = useRef<HTMLDivElement>(null)
  const { data: ticket, isLoading } = useActionData(() => getTicket({ id }))
  // メンションを表示名で出すため。取得に失敗しても印刷は止めない
  const { assignees, isLoading: isAssigneesLoading } = useBoardAssignees(ticket?.boardId)
  // 日時をユーザーのタイムゾーンで出すため、セッションの取得も待つ((sidenav) の SessionPending の外にあるため)
  const { isPending: isSessionPending } = authClient.useSession()

  const comment = ticket && commentId !== undefined ? findPrintableComment(ticket.comments, commentId) : null
  const isFound = !!ticket && (commentId === undefined || !!comment)
  const documentTitle = isFound
    ? ticketPrintTitle({
        displayId: ticket.displayId,
        title: ticket.title,
        typeLabel: comment ? t(TICKET_COMMENT_TYPE_LOCALE[comment.type]) : undefined,
      })
    : undefined

  useEffect(() => {
    if (documentTitle) {
      document.title = documentTitle
    }
  }, [documentTitle])

  const { save: saveHtml, isPending: isSavingHtml } = useSaveHtml(
    ref,
    documentTitle ? { title: documentTitle, fileName: ticketExportFileName(documentTitle) } : undefined,
  )

  useWhenRendered(ref, isFound && !isAssigneesLoading && !isSessionPending, () =>
    format === 'html' ? void saveHtml() : window.print(),
  )

  if (isLoading) {
    return <PanelSkeleton />
  }

  return (
    <div className='mx-auto w-full max-w-3xl p-4 print:max-w-none print:p-0'>
      {isFound ? (
        <>
          <PrintToolbar format={format} onSaveHtml={() => void saveHtml()} isSavingHtml={isSavingHtml} />
          <div ref={ref}>
            {comment ? (
              <PrintComment ticket={ticket} comment={comment} mentionUsers={assignees} />
            ) : (
              <PrintTicket ticket={ticket} mentionUsers={assignees} />
            )}
          </div>
        </>
      ) : (
        <NoAccessView icon={<TicketIcon />} title={t('ticket')} />
      )}
    </div>
  )
}
