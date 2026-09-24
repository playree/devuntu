import { isTicketStatus } from '@/lib/board/task'
import { scTicketSearch } from '@/lib/schema/schema'
import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { TicketsClient } from './client'

export const metadata: Metadata = { title: en.ticket }

const TicketsPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ boardId?: string; status?: string | string[]; assignee?: string }>
}) => {
  const { boardId, status, assignee } = await searchParams
  // 不正な値をそのまま Server Action に渡すとバリデーションエラーになるので、ここで弾いて既定の条件に落とす
  const statuses = [status ?? []].flat().filter(isTicketStatus)
  return (
    <TicketsClient
      initialFilter={{
        boardId: scTicketSearch.shape.boardId.safeParse(boardId).data ?? null,
        status: statuses.length > 0 ? statuses : undefined,
        assignee: scTicketSearch.shape.assignee.safeParse(assignee).data ?? null,
      }}
    />
  )
}
export default TicketsPage
