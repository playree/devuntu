'use client'

import { ExportMenu, ExportMenuItem } from '@/components/export-menu'
import { CodeBracketIcon, PrinterIcon } from '@/components/icon'
import { useHtmlExport } from '@/components/print-export'
import { ticketPrintPath } from '@/lib/board/ticket-print'
import type { PrintFormat } from '@/lib/print-export'
import { useLocale } from '@/locale/client'
import { ButtonProps } from '@heroui/react'
import { FC } from 'react'

/**
 * チケット(commentId があればそのプラン/報告書/アナウンス)を PDF / HTML に出力するメニュー。
 * PDF は印刷用ページを別タブで開いて印刷ダイアログを出し、HTML は印刷用ページを見えない iframe で描いてその場で保存する
 */
export const TicketExportMenu: FC<{
  ticketId: string
  commentId?: string
  variant?: ButtonProps['variant']
  className?: string
}> = ({ ticketId, commentId, variant, className }) => {
  const { t } = useLocale()
  const { exportHtml, isPending } = useHtmlExport()
  const items: ExportMenuItem<PrintFormat>[] = [
    { id: 'pdf', label: t('export_pdf'), icon: <PrinterIcon width={16} /> },
    { id: 'html', label: t('export_html'), icon: <CodeBracketIcon width={16} /> },
  ]

  return (
    <ExportMenu
      items={items}
      variant={variant}
      className={className}
      isPending={isPending}
      onAction={(format) => {
        if (format === 'html') {
          void exportHtml(ticketPrintPath(ticketId, { commentId, format }))
          return
        }
        window.open(ticketPrintPath(ticketId, { commentId, format }), '_blank', 'noopener')
      }}
    />
  )
}
