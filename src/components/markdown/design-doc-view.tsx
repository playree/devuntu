'use client'

import { useResolvedTheme } from '@/lib/use-resolved-theme'
import { useLocale } from '@/locale/client'
import { cn, Skeleton } from '@heroui/react'
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

/** ビューアのテーマ。テーマが決まる前は OS の設定に従わせる */
const viewerTheme = (resolvedTheme: string | undefined): 'light' | 'dark' | 'auto' =>
  resolvedTheme === 'dark' ? 'dark' : resolvedTheme === 'light' ? 'light' : 'auto'

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
  /** 比べる版(古い版)の本文。渡すと `markdown` をその版からの差分付きで表示する */
  compareWith?: string
  /** 比べる版の説明。差分バーに出る */
  compareLabel?: string
  /** 差分バーを閉じたとき。ここで `compareWith` を外す */
  onCloseDiff?: () => void
}> = ({ markdown, documentId, className, onRevealLine, viewerRef, compareWith, compareLabel, onCloseDiff }) => {
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
        theme={viewerTheme(resolvedTheme)}
        readFile={readNoFile}
        resolveResource={resolveResource}
        onOpenLink={openLink}
        onRevealLine={onRevealLine}
        compareWith={compareWith}
        compareLabel={compareLabel}
        onCloseDiff={onCloseDiff}
        // 本文は他の利用者も書けるので、生 HTML がアプリの画面に効かないよう制限する
        restrictHtml
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
    <div // 設計書ページのビューアと同じ枠。内側の余白は globals.css の .design-doc-list で取る
      className={cn('design-doc-list border-default-200 overflow-hidden rounded-xl border', className)}
    >
      <DesignDocList
        documents={documents}
        title={title}
        fileLabel={fileLabel}
        filterPlaceholder={filterPlaceholder}
        empty={empty}
        keepOrder
        limitContentWidth={false}
        lang={viewerLang(locale)}
        theme={viewerTheme(resolvedTheme)}
        onOpenLink={openLink}
      />
    </div>
  )
}
