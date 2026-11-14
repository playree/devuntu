'use client'

/**
 * 設計書の印刷用表示の本体。ブラウザ専用で大きいので `next/dynamic` の `ssr: false` 経由で読み込む前提。
 * 描画の完了(図を含む)を知るため、React 版ではなく `createViewer` を使う
 */
import { Skeleton } from '@heroui/react'
import { createViewer } from 'markdown-design-doc-viewer-embed'
import 'markdown-design-doc-viewer-embed/viewer.css'
import { FC, useEffect, useRef, useState } from 'react'
import { readNoFile, resolveResource } from './design-doc-view'

const DesignDocPrintCore: FC<{ markdown: string; lang: 'ja' | 'en' }> = ({ markdown, lang }) => {
  const ref = useRef<HTMLDivElement>(null)
  const [readyMarkdown, setReadyMarkdown] = useState<string>()

  useEffect(() => {
    const container = ref.current
    if (!container) {
      return
    }
    let isCancelled = false
    const viewer = createViewer(container, {
      markdown,
      lang,
      theme: 'light',
      // 紙では目次や見出し行の固定は役に立たない
      toc: false,
      stickyTableHeader: false,
      readFile: readNoFile,
      resolveResource,
    })
    // 描けなくても印刷は止めない(useWhenRendered の上限まで待たせない)
    const done = () => {
      if (!isCancelled) {
        setReadyMarkdown(markdown)
      }
    }
    viewer.ready.then(done, done)
    return () => {
      isCancelled = true
      viewer.destroy()
    }
  }, [markdown, lang])

  return (
    <>
      <div ref={ref} />
      {readyMarkdown !== markdown && (
        <Skeleton // 印刷用ページが描画の完了を待つ目印(useWhenRendered)
          data-markdown-loading
          className='h-6 w-full rounded-lg'
        />
      )}
    </>
  )
}
export default DesignDocPrintCore
