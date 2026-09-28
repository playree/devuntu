import { getServerSession } from '@/lib/auth/auth'
import { ensurePrivateBoard } from '@/lib/board/board'
import { isTicketStatus } from '@/lib/board/ticket-enum'
import { scTicketSearch } from '@/lib/schema/schema-ticket'
import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { TicketsClient } from './client'

export const metadata: Metadata = { title: en.ticket }

const TicketsPage = async ({
  searchParams,
}: {
  searchParams: Promise<{
    boardId?: string
    status?: string | string[]
    assignee?: string
    relatedTo?: string
    relation?: string
  }>
}) => {
  const { boardId, status, assignee, relatedTo, relation } = await searchParams
  // プライベートチケットもボード経由で可視化するため、一覧の取得(読み取りのみ)より先にここで用意する
  const session = await getServerSession()
  if (session) {
    await ensurePrivateBoard(session.user)
  }
  // 不正な値をそのまま Server Action に渡すとバリデーションエラーになるので、ここで弾いて既定の条件に落とす
  const statuses = [status ?? []].flat().filter(isTicketStatus)
  return (
    <TicketsClient
      /**
       * 詳細パネルの「一覧で見る」は同じ /tickets へのソフトナビゲーションになり、クライアントが再マウントされない。
       * 絞り込みは初期値でしか読まないので、URL の条件が変わったら作り直す
       */
      key={JSON.stringify({ boardId, status, assignee, relatedTo, relation })}
      initialFilter={{
        boardId: scTicketSearch.shape.boardId.safeParse(boardId).data ?? null,
        status: statuses.length > 0 ? statuses : undefined,
        assignee: scTicketSearch.shape.assignee.safeParse(assignee).data ?? null,
        relatedTo: scTicketSearch.shape.relatedTo.safeParse(relatedTo).data,
        relation: scTicketSearch.shape.relation.safeParse(relation).data,
      }}
    />
  )
}
export default TicketsPage
