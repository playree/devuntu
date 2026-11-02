'use client'

import { getTicket } from '@/app/(sidenav)/tickets/[id]/server'
import { useBoardAssignees } from '@/app/(sidenav)/tickets/use-ticket-form'
import { MultiButton } from '@/components/general/button'
import { PanelSkeleton } from '@/components/general/panel'
import { CodeBracketIcon, PrinterIcon, TicketIcon } from '@/components/icon'
import { NoAccessView } from '@/components/no-access-view'
import { notify } from '@/components/notify'
import { useActionData } from '@/lib/action/action-client'
import { authClient } from '@/lib/auth/auth-client'
import { TICKET_COMMENT_TYPE_LOCALE } from '@/lib/board/ticket-enum'
import {
  findPrintableComment,
  ticketExportFileName,
  type TicketExportFormat,
  ticketPrintTitle,
} from '@/lib/board/ticket-print'
import { buildHtmlDocument, collectPageCss, downloadHtml, snapshotElement } from '@/lib/html-export'
import { useWhenRendered } from '@/lib/use-when-rendered'
import { useLocale } from '@/locale/client'
import { FC, RefObject, useEffect, useRef, useState } from 'react'
import { PrintComment } from './print-comment'
import { PrintTicket } from './print-ticket'

/** 印刷用ページの描画結果を、画像と CSS を埋め込んだ 1 つの HTML ファイルとして保存する */
const useSaveHtml = (ref: RefObject<HTMLElement | null>, title: string | undefined) => {
  const { t } = useLocale()
  const [isPending, setIsPending] = useState(false)
  const save = async () => {
    const container = ref.current
    if (!container || !title) {
      return
    }
    setIsPending(true)
    try {
      const html = buildHtmlDocument({
        title,
        lang: document.documentElement.lang,
        htmlClass: document.documentElement.className,
        bodyClass: document.body.className,
        css: collectPageCss(),
        body: await snapshotElement(container),
      })
      downloadHtml(ticketExportFileName(title), html)
    } catch {
      notify.error(t('msg_save_html_failed'))
    } finally {
      setIsPending(false)
    }
  }
  return { save, isPending }
}

/** 印刷時は隠す操作欄。自動の印刷ダイアログ / HTML 保存の後に、やり直しや別形式での保存をできるようにする */
const PrintToolbar: FC<{ format: TicketExportFormat; onSaveHtml: () => void; isSavingHtml: boolean }> = ({
  format,
  onSaveHtml,
  isSavingHtml,
}) => {
  const { t } = useLocale()
  return (
    <div className='mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-b pb-3 print:hidden'>
      <MultiButton size='sm' icon={<PrinterIcon width={16} />} onPress={() => window.print()}>
        {t('print_or_save_pdf')}
      </MultiButton>
      <MultiButton size='sm' icon={<CodeBracketIcon width={16} />} isPending={isSavingHtml} onPress={onSaveHtml}>
        {t('save_html')}
      </MultiButton>
      <span className='text-muted text-xs'>{t(format === 'html' ? 'msg_save_html_hint' : 'msg_print_pdf_hint')}</span>
    </div>
  )
}

/**
 * チケットの印刷用ページ。commentId を渡すとそのプラン/報告書だけ、無ければチケット全体を出す。
 * 描画が終わったら format に応じて印刷ダイアログを開くか、HTML を保存する。
 * 認可はチケット詳細と同じ getTicket で行う
 */
export const TicketPrintClient: FC<{ id: string; commentId?: string; format: TicketExportFormat }> = ({
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

  const { save: saveHtml, isPending: isSavingHtml } = useSaveHtml(ref, documentTitle)

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
