'use client'

import { useResolvedTheme } from '@/lib/use-resolved-theme'
import { useLocale } from '@/locale/client'
import { Skeleton } from '@heroui/react'
import type { DesignDocListDocument, DesignDocViewerHandle } from 'markdown-design-doc-viewer-embed/react'
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

const DesignDocList = dynamic(() => import('./design-doc-list-core'), {
  ssr: false,
  loading: () => <Skeleton className='h-40 w-full rounded-xl' />,
})

/** ビューアの文言の言語。ビューアは ja / en だけなので、ほかの言語は en にする */
export const viewerLang = (locale: string): 'ja' | 'en' => (locale === 'ja' ? 'ja' : 'en')

/** ワイヤーフレームの別ファイルは扱わない。本文に書かれたパスを同一オリジンへ fetch させないため、常に読めないとする */
export const readNoFile = async () => undefined

/**
 * アップロードした添付(`/api/upload/...`)はそのまま、ほかは今のオリジンを基準に解決する。
 * 解決できない URL はそのまま返す(ビューアは例外を拾わないので、1つの壊れた画像で本文全体が描けなくなる)
 */
export const resolveResource = (src: string): string => {
  if (src.startsWith('/api/upload/')) {
    return src
  }
  try {
    return new URL(src, window.location.origin).href
  } catch {
    return src
  }
}

/** 本文のリンクを開く。同一オリジン(相対を含む)は画面内で遷移し、ほかは新しいタブ(http(s) / mailto のみ) */
const useOpenLink = () => {
  const router = useRouter()
  return useCallback(
    (href: string) => {
      let url: URL
      try {
        url = new URL(href, window.location.href)
      } catch {
        // 書き間違いの URL は開かない
        return
      }
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
        lang={viewerLang(locale)}
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

/**
 * 設計書一覧(Markdown Design Doc Viewer の拡張と同じ表)。フォルダごとの表に、front matter の版数・ステータスなどを並べ、
 * 絞り込みと列の並べ替えができる。中でスクロールせず、一覧の高さで表示する
 */
export const DesignDocListView: FC<{
  /** 変わったときだけ表示し直すので、取り直したとき以外は同じ配列を渡すこと */
  documents: DesignDocListDocument[]
  title: string
  fileLabel: string
  filterPlaceholder: string
  empty: string
  className?: string
}> = ({ documents, title, fileLabel, filterPlaceholder, empty, className }) => {
  const { locale } = useLocale()
  const resolvedTheme = useResolvedTheme()
  const openLink = useOpenLink()

  return (
    <div className={className}>
      <DesignDocList
        documents={documents}
        title={title}
        fileLabel={fileLabel}
        filterPlaceholder={filterPlaceholder}
        empty={empty}
        keepOrder
        limitContentWidth={false}
        lang={viewerLang(locale)}
        theme={resolvedTheme === 'dark' ? 'dark' : resolvedTheme === 'light' ? 'light' : 'auto'}
        onOpenLink={openLink}
      />
    </div>
  )
}
