'use client'

import { getTicket } from '@/app/(sidenav)/tickets/[id]/server'
import { useBoardAssignees } from '@/app/(sidenav)/tickets/use-ticket-form'
import { MultiButton } from '@/components/general/button'
import { PanelSkeleton } from '@/components/general/panel'
import { PrinterIcon, TicketIcon } from '@/components/icon'
import { NoAccessView } from '@/components/no-access-view'
import { useActionData } from '@/lib/action/action-client'
import { authClient } from '@/lib/auth/auth-client'
import { TICKET_COMMENT_TYPE_LOCALE } from '@/lib/board/ticket-enum'
import { findPrintableComment, ticketPrintTitle } from '@/lib/board/ticket-print'
import { usePrintWhenReady } from '@/lib/use-print-when-ready'
import { useLocale } from '@/locale/client'
import { FC, useEffect, useRef } from 'react'
import { PrintComment } from './print-comment'
import { PrintTicket } from './print-ticket'

/** 印刷時は隠す操作欄。自動で開いた印刷ダイアログを閉じた後に、やり直せるようにする */
const PrintToolbar: FC = () => {
  const { t } = useLocale()
  return (
    <div className='mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-b pb-3 print:hidden'>
      <MultiButton size='sm' icon={<PrinterIcon width={16} />} onPress={() => window.print()}>
        {t('print_or_save_pdf')}
      </MultiButton>
      <span className='text-muted text-xs'>{t('msg_print_pdf_hint')}</span>
    </div>
  )
}

/**
 * チケットの印刷用ページ。commentId を渡すとそのプラン/報告書だけ、無ければチケット全体を出す。
 * 認可はチケット詳細と同じ getTicket で行う
 */
export const TicketPrintClient: FC<{ id: string; commentId?: string }> = ({ id, commentId }) => {
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

  usePrintWhenReady(ref, isFound && !isAssigneesLoading && !isSessionPending)

  if (isLoading) {
    return <PanelSkeleton />
  }

  return (
    <div className='mx-auto w-full max-w-3xl p-4 print:max-w-none print:p-0'>
      {isFound ? (
        <>
          <PrintToolbar />
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
