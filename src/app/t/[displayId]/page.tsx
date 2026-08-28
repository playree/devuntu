import { getServerSession } from '@/lib/auth/auth'
import { findTicketIdByDisplayId } from '@/lib/board/board'
import { notFound, redirect } from 'next/navigation'
import { FC } from 'react'

/**
 * 表示ID(`KEY-番号`)で開ける短縮URL。チャットや議事録に貼った表記からそのまま飛べるようにする。
 *
 * 未存在とアクセス不可はどちらも 404 にして、他ボードのチケットの有無を答えないようにする。
 * 未ログインのアクセスは proxy がサインインへ回し、ログイン後にこの URL へ戻ってくる。
 */
const TicketByDisplayIdPage: FC<{ params: Promise<{ displayId: string }> }> = async ({ params }) => {
  const { displayId } = await params
  const session = await getServerSession()
  if (!session?.user) {
    notFound()
  }

  const id = await findTicketIdByDisplayId(session.user, displayId)
  if (!id) {
    notFound()
  }
  redirect(`/tickets/${id}`)
}
export default TicketByDisplayIdPage
