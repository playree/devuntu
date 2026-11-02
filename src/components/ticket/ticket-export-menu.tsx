'use client'

import { MultiButton } from '@/components/general/button'
import { ArrowDownTrayIcon, CodeBracketIcon, PrinterIcon } from '@/components/icon'
import { type TicketExportFormat, ticketPrintPath } from '@/lib/board/ticket-print'
import { useLocale } from '@/locale/client'
import { ButtonProps, Dropdown, Label } from '@heroui/react'
import { FC, ReactNode } from 'react'

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
  const items: { format: TicketExportFormat; label: string; icon: ReactNode }[] = [
    { format: 'pdf', label: t('export_pdf'), icon: <PrinterIcon width={16} /> },
    { format: 'html', label: t('export_html'), icon: <CodeBracketIcon width={16} /> },
  ]

  return (
    <Dropdown>
      <MultiButton
        isIconOnly
        size='sm'
        variant={variant}
        className={className}
        tooltip={t('export')}
        icon={<ArrowDownTrayIcon width={16} />}
      />
      <Dropdown.Popover placement='bottom end'>
        <Dropdown.Menu
          onAction={(key) =>
            window.open(
              ticketPrintPath(ticketId, { commentId, format: key as TicketExportFormat }),
              '_blank',
              'noopener',
            )
          }
        >
          {items.map((item) => (
            <Dropdown.Item key={item.format} id={item.format} textValue={item.label}>
              {item.icon}
              <Label>{item.label}</Label>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}
