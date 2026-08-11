import { findTicketIdByDisplayId } from '@/lib/board'
import { notFound, redirect } from 'next/navigation'
import { FC } from 'react'

/**
 * 表示ID(`KEY-番号`)で開ける短縮URL。チャットや議事録に貼った表記からそのまま飛べるようにする。
 *
 * 認可は遷移先(`/tickets/[id]` の getTicket)で行うため、ここでは存在の解決だけをする。
 * 未ログインのアクセスは proxy がサインインへ回し、ログイン後にこの URL へ戻ってくる。
 */
const TicketByDisplayIdPage: FC<{ params: Promise<{ displayId: string }> }> = async ({ params }) => {
  const { displayId } = await params
  const id = await findTicketIdByDisplayId(decodeURIComponent(displayId))
  if (!id) {
    notFound()
  }
  redirect(`/tickets/${id}`)
}
export default TicketByDisplayIdPage
