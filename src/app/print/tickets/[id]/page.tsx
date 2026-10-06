import { PRINT_COMMENT_PARAM } from '@/lib/board/ticket-print'
import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { TicketPrintClient } from './client'

export const metadata: Metadata = { title: en.ticket }

/**
 * チケットの印刷用ページ(PDF 出力)。サイドバーを出さないよう (sidenav) の外に置く。
 * データ取得と認可はチケット詳細と同じくクライアント側の Server Action で行う
 */
const TicketPrintPage: FC<{
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}> = async ({ params, searchParams }) => {
  const { id } = await params
  const commentId = (await searchParams)[PRINT_COMMENT_PARAM]
  return <TicketPrintClient id={id} commentId={typeof commentId === 'string' ? commentId : undefined} />
}
export default TicketPrintPage
