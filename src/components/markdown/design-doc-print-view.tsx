'use client'

import { useLocale } from '@/locale/client'
import { Skeleton } from '@heroui/react'
import dynamic from 'next/dynamic'
import { FC } from 'react'

const DesignDocPrintCore = dynamic(() => import('./design-doc-print-core'), {
  ssr: false,
  loading: () => (
    <Skeleton // 印刷用ページが描画の完了を待つ目印(useWhenRendered)
      data-markdown-loading
      className='h-6 w-full rounded-lg'
    />
  ),
})

/**
 * 設計書の印刷用表示(Wiki の PDF / HTML 出力)。画面の DesignDocView と違い、目次を出さず、中でスクロールせずに文書全体を流す。
 * 図まで描き終わるまでは、印刷用ページが待つ目印(`data-markdown-loading`)を置く
 */
export const DesignDocPrintView: FC<{ markdown: string }> = ({ markdown }) => {
  const { locale } = useLocale()
  return (
    <div className='design-doc-print'>
      <DesignDocPrintCore markdown={markdown} lang={locale === 'ja' ? 'ja' : 'en'} />
    </div>
  )
}
