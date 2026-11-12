'use client'

import { useResolvedTheme } from '@/lib/use-resolved-theme'
import { useLocale } from '@/locale/client'
import { Skeleton } from '@heroui/react'
import type { DesignDocViewerHandle } from 'markdown-design-doc-viewer-embed/react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { FC, RefObject, useCallback } from 'react'

/**
 * 図と見出しを横に並べる幅。既定の 1000px だと、サイドメニューを開いた 1280px の画面(本文は約 990px)で縦積みになるため下げる
 */
const SPLIT_MIN_WIDTH = 900

const DesignDocViewer = dynamic(() => import('./design-doc-viewer-core'), {
  ssr: false,
  loading: () => <Skeleton className='h-full w-full rounded-xl' />,
})

/** ワイヤーフレームの別ファイルは扱わない。本文に書かれたパスを同一オリジンへ fetch させないため、常に読めないとする */
const readNoFile = async () => undefined

/** アップロードした添付(`/api/upload/...`)はそのまま、ほかは今のオリジンを基準に解決する */
const resolveResource = (src: string): string =>
  src.startsWith('/api/upload/') ? src : new URL(src, window.location.origin).href

/** 本文のリンクを開く。同一オリジン(相対を含む)は画面内で遷移し、ほかは新しいタブ(http(s) / mailto のみ) */
const useOpenLink = () => {
  const router = useRouter()
  return useCallback(
    (href: string) => {
      const url = new URL(href, window.location.href)
      if (url.origin === window.location.origin) {
        router.push(`${url.pathname}${url.search}${url.hash}`)
        return
      }
      if (['http:', 'https:', 'mailto:'].includes(url.protocol)) {
        window.open(url.href, '_blank', 'noopener,noreferrer')
      }
    },
    [router],
  )
}

/**
 * 設計書(Markdown Design Doc Viewer の形式)の表示。図と見出しの紐付け・項目の表・設計書ヘッダ・目次をビューアが描く。
 * ビューアは中でスクロールするので、高さを className で与えること
 */
export const DesignDocView: FC<{
  markdown: string
  /** 文書の識別子。変わると先頭から表示し直し、同じ間は更新してもスクロール位置を保つ */
  documentId: string
  className?: string
  /** ダブルクリックした行(0 始まり)。エディタの該当行へ移すときに渡す */
  onRevealLine?: (line: number) => void
  viewerRef?: RefObject<DesignDocViewerHandle | null>
}> = ({ markdown, documentId, className, onRevealLine, viewerRef }) => {
  const { locale } = useLocale()
  const resolvedTheme = useResolvedTheme()
  const openLink = useOpenLink()

  return (
    <div className={className}>
      <DesignDocViewer
        ref={viewerRef}
        className='h-full'
        markdown={markdown}
        documentId={documentId}
        lang={locale === 'ja' ? 'ja' : 'en'}
        splitMinWidth={SPLIT_MIN_WIDTH}
        theme={resolvedTheme === 'dark' ? 'dark' : resolvedTheme === 'light' ? 'light' : 'auto'}
        readFile={readNoFile}
        resolveResource={resolveResource}
        onOpenLink={openLink}
        onRevealLine={onRevealLine}
      />
    </div>
  )
}
