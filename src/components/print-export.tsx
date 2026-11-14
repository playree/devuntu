'use client'

import { MultiButton } from '@/components/general/button'
import { CodeBracketIcon, PrinterIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { buildHtmlDocument, collectPageCss, downloadHtml, snapshotElement } from '@/lib/html-export'
import type { PrintFormat } from '@/lib/print-export'
import { useLocale } from '@/locale/client'
import { FC, RefObject, useState } from 'react'

/** 印刷用ページの描画結果を、画像と CSS を埋め込んだ 1 つの HTML ファイルとして保存する */
export const useSaveHtml = (
  ref: RefObject<HTMLElement | null>,
  doc: { title: string; fileName: string } | undefined,
) => {
  const { t } = useLocale()
  const [isPending, setIsPending] = useState(false)
  const save = async () => {
    const container = ref.current
    if (!container || !doc) {
      return
    }
    setIsPending(true)
    try {
      const html = buildHtmlDocument({
        title: doc.title,
        lang: document.documentElement.lang,
        htmlClass: document.documentElement.className,
        bodyClass: document.body.className,
        css: collectPageCss(),
        body: await snapshotElement(container),
      })
      downloadHtml(doc.fileName, html)
    } catch {
      notify.error(t('msg_save_html_failed'))
    } finally {
      setIsPending(false)
    }
  }
  return { save, isPending }
}

/** 印刷時は隠す操作欄。自動の印刷ダイアログ / HTML 保存の後に、やり直しや別形式での保存をできるようにする */
export const PrintToolbar: FC<{ format: PrintFormat; onSaveHtml: () => void; isSavingHtml: boolean }> = ({
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
