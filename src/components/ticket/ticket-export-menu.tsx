'use client'

import { ExportMenu, ExportMenuItem } from '@/components/export-menu'
import { CodeBracketIcon, PrinterIcon } from '@/components/icon'
import { ticketPrintPath } from '@/lib/board/ticket-print'
import type { PrintFormat } from '@/lib/print-export'
import { useLocale } from '@/locale/client'
import { ButtonProps } from '@heroui/react'
import { FC } from 'react'

/**
 * チケット(commentId があればそのプラン/報告書/アナウンス)を PDF / HTML に出力するメニュー。
 * どちらも印刷用ページを別タブで開き、PDF は印刷ダイアログ、HTML はファイル保存をそのページが行う
 */
export const TicketExportMenu: FC<{
  ticketId: string
  commentId?: string
  variant?: ButtonProps['variant']
  className?: string
}> = ({ ticketId, commentId, variant, className }) => {
  const { t } = useLocale()
  const items: ExportMenuItem<PrintFormat>[] = [
    { id: 'pdf', label: t('export_pdf'), icon: <PrinterIcon width={16} /> },
    { id: 'html', label: t('export_html'), icon: <CodeBracketIcon width={16} /> },
  ]

  return (
    <ExportMenu
      items={items}
      variant={variant}
      className={className}
      onAction={(format) => window.open(ticketPrintPath(ticketId, { commentId, format }), '_blank', 'noopener')}
    />
  )
}
