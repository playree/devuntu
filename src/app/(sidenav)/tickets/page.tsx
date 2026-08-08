import { scTicketSearch } from '@/lib/schema'
import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { TicketsClient } from './client'

export const metadata: Metadata = { title: en.ticket }

const TicketsPage = async ({ searchParams }: { searchParams: Promise<{ boardId?: string }> }) => {
  const { boardId } = await searchParams
  // 不正な値をそのまま Server Action に渡すとバリデーションエラーになるので、ここで弾いて全ボード表示に落とす
  const initialBoardId = scTicketSearch.shape.boardId.safeParse(boardId).data ?? null
  return <TicketsClient initialBoardId={initialBoardId} />
}
export default TicketsPage
