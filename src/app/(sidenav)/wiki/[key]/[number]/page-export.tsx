'use client'

import { ExportMenu, ExportMenuItem } from '@/components/export-menu'
import { CodeBracketIcon, DocumentTextIcon, PrinterIcon } from '@/components/icon'
import { useHtmlExport } from '@/components/print-export'
import type { WikiPageType } from '@/generated/prisma/enums'
import { downloadText } from '@/lib/html-export'
import type { PrintFormat } from '@/lib/print-export'
import { wikiExportFileName, wikiExportTitle, wikiMarkdownExport, wikiPrintPath } from '@/lib/wiki/wiki-export'
import { useLocale } from '@/locale/client'
import { FC } from 'react'

type WikiExportFormat = PrintFormat | 'md'

/**
 * 表示中のページ(過去の版を選んでいればその版)を PDF / HTML / Markdown に出力するメニュー。
 * PDF は印刷用ページを別タブで開いて印刷ダイアログを出し、HTML は印刷用ページを見えない iframe で描いてその場で保存する。
 * Markdown は表示中の本文からその場で保存する
 */
export const WikiExportMenu: FC<{
  spaceKey: string
  number: number
  title: string
  type: WikiPageType
  /** 表示中の本文。過去の版の本文を取得中は undefined */
  content: string | undefined
  /** 過去の版を表示中のときの版 */
  revision?: { id: string; number: number }
}> = ({ spaceKey, number, title, type, content, revision }) => {
  const { t } = useLocale()
  const { exportHtml, isPending } = useHtmlExport()
  const items: ExportMenuItem<WikiExportFormat>[] = [
    { id: 'pdf', label: t('export_pdf'), icon: <PrinterIcon width={16} /> },
    { id: 'html', label: t('export_html'), icon: <CodeBracketIcon width={16} /> },
    { id: 'md', label: t('export_markdown'), icon: <DocumentTextIcon width={16} /> },
  ]

  const exportAs = (format: WikiExportFormat) => {
    if (format === 'html') {
      void exportHtml(wikiPrintPath({ key: spaceKey, number }, { revisionId: revision?.id, format }))
      return
    }
    if (format === 'pdf') {
      window.open(wikiPrintPath({ key: spaceKey, number }, { revisionId: revision?.id, format }), '_blank', 'noopener')
      return
    }
    if (content === undefined) {
      return
    }
    const documentTitle = wikiExportTitle({ key: spaceKey, number, title, revisionNumber: revision?.number })
    downloadText(
      wikiExportFileName(documentTitle, 'md'),
      wikiMarkdownExport({ title, type, content, origin: window.location.origin }),
      'text/markdown;charset=utf-8',
    )
  }

  return (
    <ExportMenu
      items={items}
      variant='outline'
      isPending={isPending}
      // 過去の版の本文を取得中は Markdown だけ選べない(PDF / HTML は印刷用ページが版を引く)
      disabledIds={content === undefined ? ['md'] : undefined}
      onAction={exportAs}
    />
  )
}
