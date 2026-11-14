import { PRINT_FORMAT_PARAM, parsePrintFormat } from '@/lib/print-export'
import { WIKI_PRINT_REVISION_PARAM } from '@/lib/wiki/wiki-export'
import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { WikiPrintClient } from './client'

export const metadata: Metadata = { title: en.wiki }

/**
 * Wiki ページの印刷用ページ(PDF / HTML 出力)。サイドバーを出さないよう (sidenav) の外に置く。
 * データ取得と認可はページ詳細と同じくクライアント側の Server Action で行う
 */
const WikiPrintPage: FC<{
  params: Promise<{ key: string; number: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}> = async ({ params, searchParams }) => {
  const { key, number } = await params
  const query = await searchParams
  const revisionId = query[WIKI_PRINT_REVISION_PARAM]
  return (
    <WikiPrintClient
      spaceKey={key.toUpperCase()}
      number={Number(number)}
      revisionId={typeof revisionId === 'string' ? revisionId : undefined}
      format={parsePrintFormat(query[PRINT_FORMAT_PARAM])}
    />
  )
}
export default WikiPrintPage
